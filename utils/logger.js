import { createLogger, format as _format, transports as _transports } from 'winston';

const baseFormat = _format.combine(
  _format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  _format.errors({ stack: true }),
  _format.printf(l => `${l.timestamp} ${l.level}: ${l.message}` + (l.splat !== undefined ? `${l.splat}` : ' ')),
);

const logger = createLogger({
  level: 'debug',
  format: baseFormat,
  transports: [
    new _transports.Console({
      format: _format.combine(_format.colorize(), baseFormat),
    }),
    new _transports.File({ filename: 'error.log', level: 'error' }),
    new _transports.File({ filename: 'combined.log' }),
  ],
});

export default logger;
