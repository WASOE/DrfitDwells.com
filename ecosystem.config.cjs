/**
 * PM2 process definitions for Drift & Dwells.
 *
 * Production confirmation backlog worker (authoritative consumer):
 *   pm2 start ecosystem.config.cjs --only driftdwells-confirmation-worker --env production
 *
 * Keep BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED unset/0 on the API process.
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
    }
  ]
};
