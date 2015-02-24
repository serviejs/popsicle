var gulp = require('gulp')
var requireDir = require('require-dir')

requireDir('./tasks')

gulp.on('task_err', function (taskError) {
  console.error(taskError.err.stack)
})
