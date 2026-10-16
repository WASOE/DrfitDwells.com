'use strict';

// Separate application process sharing only MongoDB, not service state.
const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const StayChange = require('../../models/StayChange');
const CabinNightClaim = require('../../models/CabinNightClaim');
const { rebookReservation } = require('../../services/stayChange/rebookStayChangeService');

process.once('message', async ({ uri, request, interruptAfterClaim, interruptPhase }) => {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const interrupt = async phase => {
      if (interruptPhase !== phase) return;
      interruptPhase = null;
      process.send({ paused: phase });
      await new Promise(resolve => process.once('message', resolve));
    };
    const save = StayChange.prototype.save;
    StayChange.prototype.save = async function (...args) {
      const result = await save.apply(this, args);
      await interrupt(this.status);
      return result;
    };
    const create = Booking.create.bind(Booking);
    const deleteClaims = CabinNightClaim.deleteMany.bind(CabinNightClaim);
    CabinNightClaim.deleteMany = async (filter, ...args) => {
      if (String(filter.bookingId) === request.bookingId && interruptPhase === 'source_release_failure') {
        await interrupt('source_release_failure');
        throw new Error('Transient source release failure after another executor completes');
      }
      return deleteClaims(filter, ...args);
    };
    Booking.create = async (...args) => {
      if (args[0]?.provenance?.source === 'stay_change_rebook' && interruptPhase === 'replacement_failure') {
        await interrupt('replacement_failure');
        throw new Error('Lost replacement acknowledgement');
      }
      const result = await create(...args);
      if (result.provenance?.source === 'stay_change_rebook') await interrupt('replacement');
      return result;
    };
    const updateOne = Booking.updateOne.bind(Booking);
    Booking.updateOne = async (filter, update, ...args) => {
      if (filter.rebookSourceOwnerId === null && update.$set?.rebookSourceOwnerId) {
        process.send({ ready: true });
        await new Promise(resolve => process.once('message', resolve));
        const result = await updateOne(filter, update, ...args);
        if (interruptAfterClaim && result.matchedCount) {
          process.send({ claimed: true });
          // Parent terminates this process before any target claim.
          await new Promise(() => {});
        }
        return result;
      }
      if (update.$set?.cancellationSettlement?.outcome === 'rebooked_or_moved') {
        await interrupt('before_source_cas');
        const result = await updateOne(filter, update, ...args);
        await interrupt('after_source_cas');
        return result;
      }
      return updateOne(filter, update, ...args);
    };
    const result = await rebookReservation({
      ...request,
      ctx: { user: { id: 'admin-worker', role: 'admin' } }
    });
    process.send({ result });
  } catch (error) {
    process.send({ error: error.details?.code || error.code || error.message });
  } finally {
    await mongoose.disconnect();
    process.disconnect();
  }
});
