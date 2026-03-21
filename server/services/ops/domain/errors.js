function createDomainError(type, message, details = {}, status = 400) {
  const error = new Error(message);
  error.code = type;
  error.type = type;
  error.status = status;
  error.details = details;
  return error;
}

module.exports = {
  createDomainError
};
