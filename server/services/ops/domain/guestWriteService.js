const { editGuestContact: editGuestContactOnReservation } = require('./reservationWriteService');

async function editGuestContact(input) {
  return editGuestContactOnReservation(input);
}

module.exports = {
  editGuestContact
};
