'use strict';

var async = require('async');
var nconf = require('nconf');
var semver = require('semver');
var winston = require('winston');

var versions = require('../../admin/versions');
var db = require('../../database');
var meta = require('../../meta');
var plugins = require('../../plugins');

var dashboardController = module.exports;

dashboardController.get = function (req, res, next) {
	async.waterfall([
		function (next) {
			async.parallel({
				stats: getStats,
				notices: function (next) {
					var notices = [
						{
							done: !meta.reloadRequired,
							doneText: '[[admin/general/dashboard:restart-not-required]]',
							notDoneText: '[[admin/general/dashboard:restart-required]]',
						},
						{
							done: plugins.hasListeners('filter:search.query'),
							doneText: '[[admin/general/dashboard:search-plugin-installed]]',
							notDoneText: '[[admin/general/dashboard:search-plugin-not-installed]]',
							tooltip: '[[admin/general/dashboard:search-plugin-tooltip]]',
							link: '/admin/extend/plugins',
						},
					];

					if (global.env !== 'production') {
						notices.push({
							done: false,
							notDoneText: '[[admin/general/dashboard:running-in-development]]',
						});
					}

					plugins.fireHook('filter:admin.notices', notices, next);
				},
				latestVersion: function (next) {
					versions.getLatestVersion(function (err, result) {
						if (err) {
							winston.error('[acp] Failed to fetch latest version', err);
						}

						next(null, err ? null : result);
					});
				},
			}, next);
		},
		function (results) {
			var version = nconf.get('version');

			res.render('admin/general/dashboard', {
				version: version,
				lookupFailed: results.latestVersion === null,
				latestVersion: results.latestVersion,
				upgradeAvailable: results.latestVersion && semver.gt(results.latestVersion, version),
				currentPrerelease: versions.isPrerelease.test(version),
				notices: results.notices,
				stats: results.stats,
				canRestart: !!process.send,
			});
		},
	], next);
};

function getStats(callback) {
	async.waterfall([
		function (next) {
			async.parallel([
				function (next) {
					getStatsForSet('ip:recent', 'uniqueIPCount', next);
				},
				function (next) {
					getStatsForSet('users:joindate', 'userCount', next);
				},
				function (next) {
					getStatsForSet('posts:pid', 'postCount', next);
				},
				function (next) {
					getStatsForSet('topics:tid', 'topicCount', next);
				},
			], next);
		},
		function (results, next) {
			results[0].name = '[[admin/general/dashboard:unique-visitors]]';
			results[1].name = '[[admin/general/dashboard:users]]';
			results[2].name = '[[admin/general/dashboard:posts]]';
			results[3].name = '[[admin/general/dashboard:topics]]';

			next(null, results);
		},
	], callback);
}

function getStatsForSet(set, field, callback) {
	var terms = {
		day: 86400000,
		week: 604800000,
		month: 2592000000,
	};

	var now = Date.now();
	async.parallel({
		day: function (next) {
			db.sortedSetCount(set, now - terms.day, '+inf', next);
		},
		week: function (next) {
			db.sortedSetCount(set, now - terms.week, '+inf', next);
		},
		month: function (next) {
			db.sortedSetCount(set, now - terms.month, '+inf', next);
		},
		alltime: function (next) {
			getGlobalField(field, next);
		},
	}, callback);
}

function getGlobalField(field, callback) {
	db.getObjectField('global', field, function (err, count) {
		callback(err, parseInt(count, 10) || 0);
	});
}
