var Fs = require('fs');
var Hoek = require('hoek');
var Path = require('path');
var Smelt = require('smelt');
var Wreck = require('wreck');

var internals = {
    defaults: {
        apiUrl: 'https://api.github.com'
    }
};

module.exports = internals.Bobber = function (options) {

    var settings = Hoek.applyToDefaults(internals.defaults, options);
    internals.Bobber.settings = settings;
    internals.settings = settings;
    this.getElements = exports.getElements;
    this.getAllCommits = exports.getAllCommits;
    this.getCompareCommits = exports.getCompareCommits;
    this.getLatestCommit = exports.getLatestCommit;
    this.getLatestRemoteCommit = exports.getLatestRemoteCommit;
    this.getBranches = exports.getBranches;
    this.getPullRequests = exports.getPullRequests;
    this.getPullRequest = exports.getPullRequest;
    this.mergePullRequest = exports.mergePullRequest;
    this.updateCommitStatus = exports.updateCommitStatus;
    this.validateUrl = exports.validateUrl;
    this.checkoutCode = exports.checkoutCode;
};

exports.checkoutCode = function(path, scm) {

    var smelt = new Smelt({ dirPath: path });
    var gitPath = Path.join(path, '.git');
    var command;
    if (Fs.existsSync( gitPath )) {
        command = 'git pull origin ' + scm.branch;
    } else {
        command = 'git clone --branch=' + scm.branch + ' ' + scm.url + ' .';
    }
    var commandResult = smelt.runCommand(command);
    var result = {
        startTime: commandResult.startTime,
        finishTime: commandResult.finishTime,
        status: commandResult.status,
        commands: [ commandResult ]
    };
    return result;
};

exports.getElements = function() {

    var elements = [];
    elements.push({ 'tag': 'Url', fieldType: 'text', name: 'scmUrl', placeHolder: 'https://github.com/fishin/bobber' });
    elements.push({ 'tag': 'Branch', fieldType: 'text', name: 'scmBranch', placeHolder: 'master' });
    return elements;
};

exports.getAllCommits = function(path) {

    var smelt = new Smelt({ dirPath: path });
    var command = 'git log --pretty=format:"%H---%an---<%ae>---%ai---%s"';
    var result = smelt.runCommand(command);
    var commits = internals.processCommits(result);
    return commits;
};

exports.getCompareCommits = function(path, startCommit, endCommit) {

    var smelt = new Smelt({ dirPath: path });
    var command = 'git log --pretty=format:"%H---%an---<%ae>---%ai---%s" ' + startCommit + '...' + endCommit;
    var result = smelt.runCommand(command);
    var commits = internals.processCommits(result);
    return commits;
};

internals.processCommits = function(result) {

    if (result.stdout) {
        var history = result.stdout.split('\n');
        var gitLog = [];
        for (var i = 0; i < history.length; i++) {
            //console.log(i + ' ' + history[i]);
            var entry = history[i].split('---');
            var commit = entry[0].substr(1, entry[0].length);
            var authorDate = entry[3].split(' ');
            var gitObj = {
                commit: commit,
                shortCommit: commit.substr(0,7),
                authorName: entry[1],
                authorEmail: entry[2],
                authorDate: authorDate[0] + ' ' + authorDate[1],
                message: entry[4].substr(0, entry[4].length - 1)
            };
            gitLog.push(gitObj);
        }
        return gitLog;
    } else {
        //console.log('no result for commits');
        return [];
    }
};

exports.getLatestCommit = function(path) {

    var smelt = new Smelt({ dirPath: path });
    var result = smelt.runCommand('git rev-parse HEAD');
    return result.stdout;
};

exports.getLatestRemoteCommit = function(scm) {

    var smelt = new Smelt({ dirPath: '.' });
    var result = smelt.runCommand('git ls-remote --heads origin');
    var resultArray = result.stdout.split('\n');
    for (var i = 0; i < resultArray.length; i++) {
       var commit = resultArray[i].split('refs/heads/')[0].trim();
       var branch = resultArray[i].split('refs/heads/')[1];
       if (branch === scm.branch) {
           return commit;
       }
    }
    return null;
};

exports.getBranches = function(path) {

    var branches = [];
    var smelt = new Smelt({ dirPath: path });
    var result = smelt.runCommand('git ls-remote --heads origin');
    var resultArray = result.stdout.split('\n');
    for (var i = 0; i < resultArray.length; i++) {
       branches[i] = resultArray[i].split('refs/heads/')[1];
    }
    return branches;
};

internals.checkApiRateLimit = function(scm, cb) {

    var url = internals.Bobber.settings.apiUrl + '/rate_limit';
    var options = {
        headers:   {
            'User-Agent': 'ficion'
        }
    };
    Wreck.get(url, options, function(err, res, payload) {

        var pl = JSON.parse(payload);
        if (pl.rate.remaining === 0) {
            console.log('hit rate limit');
            return cb(pl);
        }
        return cb(null);
    });
};

exports.getPullRequests = function(scm, token, cb) {

    var parsedUrl = internals.parseUrl(scm.url);
    var url = internals.Bobber.settings.apiUrl + '/repos/' + parsedUrl.org + '/' + parsedUrl.repo + '/pulls';
    var options = {
        headers:   {
            'User-Agent': 'ficion',
            'X-OAuth-Scopes': 'repo'
        }
    };
    if (token) {
        options.headers['Authorization'] = 'token ' + token;
    }

    internals.checkApiRateLimit(scm, function(err) {

        if (err) {
            console.log(err);
            return cb([]);
        } else {
            Wreck.get(url, options, function(err, res, payload) {

                var pl = JSON.parse(payload);
                if (pl.message) {
                    console.log(pl.message);
                    return cb([]);
                } else {
                    var prs = [];
                    for (var i = 0; i < pl.length; i++) {
                        prs[i] = {
                            number: pl[i].number,
                            title: pl[i].title,
                            commit: pl[i].head.sha,
                            mergeCommit: pl[i].merge_commit_sha,
                            shortCommit: pl[i].head.sha.substr(0,7),
                            repoUrl: scm.url
                        };
                    }
                    return cb(prs);
                }
            });
        }
    });
};

exports.validateUrl = function(scm) {

    if (scm.url.match('https://github.com')) {
        // check to see if its valid
        var smelt = new Smelt({ dirPath: '/tmp' });
        var rewriteUrl = scm.url.replace('https://github.com','https://anon:anon@github.com');
        var result = smelt.runCommand('git ls-remote ' + rewriteUrl);
        if (result.stderr) {
            return false;
        } else {
            return true;
        }
    } else {
       return true;
    }
};

exports.getPullRequest = function (scm, number, token, cb) {

    var parsedUrl = internals.parseUrl(scm.url);
    var url = internals.Bobber.settings.apiUrl + '/repos/' + parsedUrl.org + '/' + parsedUrl.repo + '/pulls/' + number;
    var options = {
        headers:   {
            'User-Agent': 'ficion',
            'X-OAuth-Scopes': 'repo'
        }
    };
    if (token) {
        options.headers['Authorization'] = 'token ' + token;
    }

    internals.checkApiRateLimit(scm, function(err) {

        if (err) {
            console.log(err);
            return cb(null);
        } else {
            Wreck.get(url, options, function(err, res, payload) {

                var pl = JSON.parse(payload);
                //console.log(pl);
                if (pl.message) {
                    console.log(pl.message);
                    return cb(null);
                } else {
                    var pr = {
                        number: pl.number,
                        title: pl.title,
                        commit: pl.head.sha,
                        mergeCommit: pl.merge_commit_sha,
                        shortCommit: pl.head.sha.substr(0,7),
                        repoUrl: scm.url
                    };
                    return cb(pr);
                }
            });
        }
    });
};

exports.mergePullRequest = function(scm, number, token, cb) {

    var parsedUrl = internals.parseUrl(scm.url);
    var url = internals.Bobber.settings.apiUrl + '/repos/' + parsedUrl.org + '/' + parsedUrl.repo + '/pulls/' + number + '/merge';
    var options = {
        headers:   {
            'User-Agent': 'ficion',
            'Authorization': 'token ' + token,
            'Content-Type': 'application/json',
            'X-OAuth-Scopes': 'repo'
        },
        payload: '{ "commit_message": "Pull Request successfully merged" }'
    };

    internals.checkApiRateLimit(scm, function(err) {

        if (err) {
            var error = {
                error: err,
                merged: false
            };
            return cb(error);
        } else {
            Wreck.put(url, options, function(err, res, payload) {

                if (payload.match('message')) {
                   var pl = JSON.parse(payload);
                   if (!pl.merged) {
                      pl.error = pl.message;
                      pl.merged = false;
                   }
                   //console.log(pl);
                   return cb(pl);
                } else {
                   var error = {
                       error: payload,
                       merged: false
                   };
                   return cb(error);
                }
            });
        }
    });
};

exports.updateCommitStatus = function(scm, commit, state, token, cb) {

    var parsedUrl = internals.parseUrl(scm.url);
    var url = internals.Bobber.settings.apiUrl + '/repos/' + parsedUrl.org + '/' + parsedUrl.repo + '/statuses/' + commit;
    var targetUrl = "http://localhost:8080";
    var options = {
        headers:   {
            'User-Agent': 'ficion',
            'Authorization': 'token ' + token,
            'Content-Type': 'application/json',
            'X-OAuth-Scopes': 'repo'
        },
        payload: '{ "state": "'+ state +'", "target_url": "' + targetUrl +  '", "description": "'+state+'", "context": "continuous-integration/ficion" }'
    };

    internals.checkApiRateLimit(scm, function(err) {

        if (err) {
            var error = {
                error: err
            };
            return cb(error);
        } else {
            Wreck.post(url, options, function(err, res, payload) {

                if (payload.match('state')) {
                   var pl = JSON.parse(payload);
                   //console.log(pl);
                   return cb(pl);
                } else {
                   var error = {
                       error: payload
                   };
                   return cb(error);
                }
            });
        }
    });
};

internals.parseUrl = function(url) {

    var parsedUrl = {};
    var delimiter = '://';
    if (url.match('@') && !url.match('://')) {
        delimiter = '@';
    }
    parsedUrl.proto = url.split(delimiter)[0];
    var rest = url.split(delimiter)[1];
    parsedUrl.repoUrl = rest.split('/')[0];
    parsedUrl.org = rest.split('/')[1];
    parsedUrl.repo = rest.split('/')[2];
    return parsedUrl;
};
