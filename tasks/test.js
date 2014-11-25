var join  = require('path').join;
var gulp  = require('gulp');
var karma = require('karma').server;
var mocha = require('gulp-mocha');

/**
 * Test the library in the browser.
 */
gulp.task('test:browser', ['server'], function (done) {
  return karma.start({
    singleRun: true,
    configFile: join(__dirname, 'support', 'karma.conf.js')
  }, done);
});

/**
 * Test the library in node.
 */
gulp.task('test:node', ['server'], function () {
  return gulp.src(['test/support/*.js', 'test/*.js'], { read: false })
    .pipe(mocha({ reporter: 'spec' }));
});

/**
 * Run all tests.
 */
gulp.task('test', ['test:browser', 'test:node']);
