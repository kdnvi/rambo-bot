import { createLogger, format as _format, transports as _transports } from 'winston';

const logger = createLogger({
  level: 'debug',
  format: _format.combine(
    _format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    _format.colorize(),
    _format.errors({ stack: true }),
    _format.printf(l => `${l.timestamp} ${l.level}: ${l.message}` + (l.splat !== undefined ? `${l.splat}` : ' ')),
  ),
  transports: [
    // - Write all logs with importance level of `error` or less to `error.log`
    // - Write all logs with importance level of `info` or less to `combined.log`
    new _transports.Console(),
    new _transports.File({ filename: 'error.log', level: 'error' }),
    new _transports.File({ filename: 'combined.log' }),
  ],
});

export default logger;
