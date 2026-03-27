function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    return null;
  }
  return value;
}

function getFirstEnv(names) {
  for (const name of names) {
    const value = getRequiredEnv(name);
    if (value) return value;
  }
  return null;
}

function getAdminCreds() {
  return {
    username: getFirstEnv(['E2E_ADMIN_USERNAME', 'ADMIN_USERNAME', 'ADMIN_USER', 'ADMIN_USERNAM']),
    password: getFirstEnv(['E2E_ADMIN_PASSWORD', 'ADMIN_PASSWORD', 'ADMIN_PASS'])
  };
}

function getOpsCreds() {
  return {
    username: getFirstEnv(['E2E_OPS_USERNAME', 'OPS_USERNAME']),
    password: getFirstEnv(['E2E_OPS_PASSWORD', 'OPS_PASSWORD'])
  };
}

module.exports = {
  getAdminCreds,
  getOpsCreds
};
