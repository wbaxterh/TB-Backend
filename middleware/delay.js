const config = require('config');

module.exports = async (_req, _res, next) => {
  setTimeout(() => next(), config.get('delay'));
};
