var gulp       = require('gulp');
var requireDir = require('require-dir');

/**
 * Require all local gulp tasks.
 */
requireDir('./tasks');

/**
 * Log all task errors for debugging.
 */
gulp.on('task_err', function (taskError) {
  console.error(taskError.err.stack);
});
