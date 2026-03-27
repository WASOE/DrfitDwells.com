const path = require('path');

const authDir = path.resolve(__dirname, '../../.auth');
const adminStorageStatePath = path.join(authDir, 'admin.json');
const opsStorageStatePath = path.join(authDir, 'ops.json');

module.exports = {
  authDir,
  adminStorageStatePath,
  opsStorageStatePath
};
