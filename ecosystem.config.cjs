/**
 * PM2 process definitions for Drift & Dwells.
 *
 * Production confirmation backlog worker (authoritative consumer):
 *   pm2 start ecosystem.config.cjs --only driftdwells-confirmation-worker --env production
 *
 * Keep BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED unset/0 on the API process.
 *
 * B8F5B accommodation hold expiry worker (not enabled — production index step required):
 *   pm2 start ecosystem.config.cjs --only driftdwells-accommodation-hold-expiry-worker
 * Keep ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE unset/0 until index ensure + ops review.
 */
module.exports = {
  apps: [
    {
      name: 'driftdwells-confirmation-worker',
      cwd: __dirname,
      script: 'server/scripts/runBookingConfirmationDeliveryWorker.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'development',
        BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED: '0'
      },
      env_production: {
        NODE_ENV: 'production',
        BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED: '1'
      }
    },
    {
      name: 'driftdwells-accommodation-hold-expiry-worker',
      cwd: __dirname,
      script: 'server/scripts/runAccommodationCheckoutHoldExpiryWorker.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // 0 = disabled clean stop; 78 = permanent index/readiness stop (do not restart).
      // Unexpected failures (e.g. 1) may restart with bounded delay/backoff.
      stop_exit_codes: [0, 78],
      restart_delay: 15000,
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'development',
        ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE: '0'
      },
      env_production: {
        NODE_ENV: 'production',
        // Disabled until production index ensure + explicit ops enablement.
        ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE: '0'
      }
    }
  ]
};
