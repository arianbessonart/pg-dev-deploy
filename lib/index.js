var cmder = require('node-cmd');
var _ = require('lodash');
var async = require('async');
var parser = require('./parse');
var fs = require('fs');
const path = require('path');
var repoPath = '';

var diffsFunctions = {'add': [], 'delete': []};
var diffsTriggers = {'add': [], 'delete': []};
var diffsPlainFile = {'add': [], 'delete': []};
var statusDict = [];
var statusByType = {'functions': {'add': 0, 'delete': 0}, 'triggers': {'add': 0, 'delete': 0}, 'trigger_functions': {'add': 0}};

var directoriesDelete = ['functions', 'triggers'];
var directoriesAdd = ['functions', 'trigger_functions', 'triggers'];
var directoriesPlain = ['current'];
var extensions = ['.sql'];

var generateFilePath = 'generate_file.sql';
var statusFilePath = 'status.out';

if (process.argv.length < 2) {
  console.log('At least one parameter(repo path)');
  exit();
} else if (process.argv[2] !== undefined && process.argv[2] !== null && process.argv[2].length > 0) {
  repoPath = process.argv[2];
} else {
  console.log('At least one parameter(repo path)');
  exit();
}

var commandPath = 'cd ' + repoPath + ';';


function getAvailablesTags(callback) {
  var command = commandPath + 'git for-each-ref --sort=taggerdate --format \'%(tag)\' refs/tags';
  var availablesTags = [];
  cmder.get(command, function (result) {
    var tags = result.split('\n');
    _.forEach(tags, function (val) {
      if (val !== '') {
        availablesTags.push(val);
      }
    });
    return callback(null, availablesTags);
  });
}

function getDiffTags(sourceTag, destTag, callback) {
  var command = commandPath + 'git diff ' + destTag + ' ' + sourceTag + ' --name-status';
  var diffs = [];
  cmder.get(command, function (result) {
    var diffsGit = result.split('\n');
    _.forEach(diffsGit, function (val) {
      if (val !== '') {
        diffArray = val.split('\t');
        status = diffArray[0];
        filePath = diffArray[1];
        diffs.push({'status': status, 'path': filePath});
      }
    });
    return callback(null, diffs);
  });
}

function getFileByRef(ref, filePath, callback) {
  var command = commandPath + 'git show ' + ref + ':' + filePath + ';';
  cmder.get(command, function (result) {
    return callback(null, result);
  });
}


function fileMustBeProcess(event, filePath) {
  var directories = [];
  if (event === 'delete') {
    directories = directoriesDelete;
  } else if (event === 'add') {
    directories = directoriesAdd;
  }
  var extname = path.extname(filePath);
  var dirname = path.dirname(filePath);
  var pathArray = dirname.split("/");
  var intersectionArray = _.intersection(pathArray, directories);
  var extension = filePath.substr(filePath.lastIndexOf('.') + 1);
  var validExtension = _.indexOf(extensions, extname) !== -1;
  var valid = intersectionArray.length > 0 && validExtension;
  return valid;
}

function exit() {
  process.exit(1);
}

function processDelete(ref, path, callback) {
  getFileByRef(ref, path, function (err, content) {
    if (fileMustBeProcess('delete', path)) {
      var fParsed = parser.parseFile(content);
      if (fParsed !== null) {
        if (fParsed.type === 'function') {
          if (fParsed.returnType === 'trigger') {
            statusDict.push({'status': 'delete', 'path': path, 'statusGenerate': false});
          } else {
            statusByType.functions.delete++;
            diffsFunctions.delete.push(fParsed.drop);
            statusDict.push({'status': 'delete', 'path': path, 'statusGenerate': true});
          }
        } else if (fParsed.type === 'trigger') {
          diffsTriggers.delete.push(fParsed.drop);
          statusByType.triggers.delete++;
          statusDict.push({'status': 'delete', 'path': path, 'statusGenerate': true});
        }
      } else {
        console.log('can not parse tag: ' + ref + ' path: ' + path);
        exit();
      }
    } else {
      statusDict.push({'status': 'delete', 'path': path, 'statusGenerate': false});
    }
    return callback(null, null);
  });
}

function processAdd(ref, path, callback) {
  getFileByRef(ref, path, function (err, content) {
    if (fileMustBeProcess('add', path)) {
      var fParsed = parser.parseFile(content);
      if (fParsed !== null) {
        if (fParsed.type === 'function') {
          if (fParsed.returnType === 'trigger') {
            statusByType.trigger_functions.add++;
            diffsFunctions.add.push(fParsed.content);
            statusDict.push({'status': 'add', 'path': path, 'statusGenerate': true});
          } else {
            statusByType.functions.add++;
            diffsFunctions.add.push(fParsed.content);
            statusDict.push({'status': 'add', 'path': path, 'statusGenerate': true});
          }
        } else if (fParsed.type === 'trigger') {
          diffsTriggers.add.push(fParsed.content);
          statusByType.triggers.add++;
          statusDict.push({'status': 'add', 'path': path, 'statusGenerate': true});
        }
      } else {
        console.log('can not parse tag: ' + ref + ' path: ' + path);
        exit();
      }
    } else if (belongsPlainDirectories(path)) {
      statusDict.push({'status': 'add', 'path': path, 'statusGenerate': true});
      diffsPlainFile.add.push(content);
    } else {
      statusDict.push({'status': 'add', 'path': path, 'statusGenerate': false});
    }
    return callback(null, null);
  });
}

function belongsPlainDirectories(filePath) {
  var extname = path.extname(filePath);
  var dirname = path.dirname(filePath);
  var pathArray = dirname.split("/");
  var intersectionArray = _.intersection(pathArray, directoriesPlain);
  var validExtension = _.indexOf(extensions, extname) !== -1;
  var ret = intersectionArray.length > 0 && validExtension;
  return ret;
}

function processModified(sourceTag, destTag, path, callback) {
  processAdd(sourceTag, path, function(err, result) {
    processDelete(destTag, path, callback);
  });
}

function statusToString(statusOb) {
  return '{status: ' + statusOb.status + ', path: ' + statusOb.path + ', statusGenerate: ' + statusOb.statusGenerate + '}';
}

function generateOut() {
  fs.truncate(generateFilePath, 0, function() { });
  fs.truncate(statusFilePath, 0, function() { });
  var statusFile = '';
  var generateFile = '';
  generateFile += '/*############################ [START][FUNCTIONS][DELETE] #####################################*/' + '\n';
  diffsFunctions.delete.forEach(function (value) {
      generateFile += value + '\n';
  });
  generateFile += '/*############################ [END][FUNCTIONS][DELETE] #####################################*/' + '\n';
  generateFile += '/*############################ [START][FUNCTIONS][ADD] #####################################*/' + '\n';
  diffsFunctions.add.forEach(function (value) {
      generateFile += value + '\n';
  });
  generateFile += '/*############################ [END][FUNCTIONS][ADD] #####################################*/' + '\n';

  generateFile += '/*############################ [START][CURRENT][ADD] #####################################*/' + '\n';
  diffsPlainFile.add.forEach(function (value) {
      generateFile += value + '\n';
  });
  generateFile += '/*############################ [END][CURRENT][ADD] #####################################*/' + '\n';
  generateFile += '/*############################ [START][TRIGGERS][DELETE] #####################################*/' + '\n';
  diffsTriggers.delete.forEach(function (value) {
      generateFile += value + '\n';
  });
  generateFile += '/*############################ [END][TRIGGERS][DELETE] #####################################*/' + '\n';

  generateFile += '/*############################ [START][TRIGGERS][ADD] #####################################*/' + '\n';
  diffsTriggers.add.forEach(function (value) {
    generateFile += value + '\n';
  });
  generateFile += '/*############################ [END][TRIGGERS][ADD] #####################################*/' + '\n';

  fs.appendFile(generateFilePath, generateFile, function(err) {
    if (err) throw err;
  });
  //var statusByType = {'functions': {'add': 0, 'delete': 0}, 'triggers': {'add': 0, 'delete': 0}, 'trigger_functions': {'add': 0}};
  statusFile += '{functions:{add: '+ statusByType.functions.add +', delete: '+ statusByType.functions.delete +'}, triggers: {add: '+ statusByType.triggers.add +', delete: '+statusByType.triggers.delete+'}, trigger_functions:{add: '+ statusByType.trigger_functions.add +'}}' + '\n';
  statusDict.forEach(function (value) {
    statusFile += statusToString(value) + '\n';
  });
  fs.appendFile(statusFilePath, statusFile, function(err) {
    if (err) throw err;
  });
}

getAvailablesTags(function (err, tags) {
  if (tags.length > 1) {
    currentTag = tags.pop();
    lastTag = tags.pop();
    getDiffTags(currentTag, lastTag, function (err, diffs) {
      async.each(diffs, function(diff, callback) {
        if (diff.status === 'M') {
          processModified(currentTag, lastTag, diff.path, callback);
        } else if (diff.status === 'D') {
          processDelete(lastTag, diff.path, callback);
        } else if (diff.status === 'A') {
          processAdd(currentTag, diff.path, callback);
        }
      }, function(err) {
          if (err) {
            console.log('end each error: ' + err);
          } else {
            generateOut();
          }
      });
    });
  }
});
