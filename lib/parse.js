
var dropSqlPrefix = 'DROP FUNCTION IF EXISTS';
var dropTrgSqlPrefix = 'DROP TRIGGER IF EXISTS';

function parseFile(content) {
  ret = parseFunction(content);
  if (ret === null) {
    ret = parseTrigger(content);
  }
  return ret;
}


function parseTrigger(content) {
  var trgParse = null;
  var re = /\s*CREATE\s+TRIGGER\s+(\w+)\s+([\s\S]*?)ON\s+([\w+.]*)\s+([\s\S]*?)EXECUTE\s+PROCEDURE\s+(.*)\;/i;
  var matches = content.match(re);
  if (matches !== null) {
    var nameTrg = matches[1].trim();
    var schema = '';
    var table = matches[3];
    if (matches[3].indexOf('.') !== -1) {
      schema = matches[3].split('.')[0];
      table = matches[3].split('.')[1];
    }
    var fun = matches[5].trim();
    trgParse = {
      name: nameTrg,
      schema: schema,
      table: table,
      function: fun,
      drop: createDropTrigger(nameTrg, schema, table),
      type: 'trigger',
      content: content
    };
  }
  return trgParse;
}

function createDropTrigger(name, schema, table) {
  var drop = dropTrgSqlPrefix + ' ' + name + ' ON ' + schema + '.' + table + ';';
  return drop;
}

function parseFunction(fileContent) {
  parseFunctionRegex = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\.([^(]*)([(\s+\w+,)='\[\]]*)\s+RETURNS\s+([(\s+\w+,)=\[\]]*)\s+AS/i;
  var matches = fileContent.match(parseFunctionRegex);
  var functionData = null;
  if (matches !== null) {
    var parsedParameters = parseParameters(matches[4]);
    functionData = {
      schema: matches[2],
      name: matches[3],
      params: parsedParameters,
      returnType: matches[5],
      content: fileContent,
      drop: createDropFunction(matches[2], matches[3], matches[4]),
      type: 'function'
    };
  }
  return functionData;
}


function createDropFunction(schema, functionName, params) {
  params = buildAlterDropParams(params, functionName);
  var dropSql = dropSqlPrefix + ' ' + schema + '.' + functionName + params + ';';
  return dropSql;
}


function buildAlterDropParams(params) {
  var paramsStr = '';
  params = params.trim().replace(/\)$/, '').replace(/^\(/, '');
  var parameters = params.split(',');
  var paramsTypes = [];
  parameters.forEach(function (value) {
    if (value != null && value.length > 0) {
      var param = parseParameter(value);
      if (param.argmode !== 'OUT') {
        paramsTypes.push(param.type);
      }
    }
  });
  return '(' + paramsTypes.join(', ').trim() + ')';
}

function parseParameters(paramsIn) {
  var params = {"in":{}, "out":{}};
  paramsIn = paramsIn.trim().replace(/\)$/, '').replace(/^\(/, '');
  var parameters = paramsIn.split(',');
  parameters.forEach(function (value) {
    if (value != null && value.length > 0) {
      var param = parseParameter(value);
      if (param.argmode.toUpperCase().indexOf("IN") != -1) {
        params['in'][param.name] = {"name": param.name, "type": param.type, "argmode": param.argmode, "default": param.isDefault};
      }
      if (param.argmode.toUpperCase().indexOf("OUT") != -1) {
        params['out'][param.name] = {"name": param.name, "type": param.type, "argmode": param.argmode, "default": param.isDefault};
      }
    }
  });
  return params;
}

function parseParameter(param) {
  var re = /\s*(INOUT|IN|OUT)?\s*(\w+)\s*([^=]*)\s*(.*)/i;
  var matches = param.match(re);
  var argmode = matches[1] == undefined ? 'IN' : matches[1].toUpperCase().trim();
  var name = matches[2].trim();
  var type = matches[3].trim();
  var isDefault = matches[4] != '';
  return {"argmode": argmode, "name": name, "type": type, "isDefault": isDefault};
}


module.exports = {
    parseFunction:parseFunction,
    parseFile:parseFile
}
