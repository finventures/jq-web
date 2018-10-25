// necessary because the default emscriptem exit() logs a lot of text.
function exit() {}

// takes a string as input and returns a string
// like `echo <jsonstring> | jq <filter>`, returning the value of STDOUT
function raw(jsonstring, filter, flags) {
  if (!initialized) {
    return "{}";
  }

  stdin = jsonstring;
  inBuffer = [];
  outBuffer = [];
  errBuffer = [];

  flags = flags || [];
  Module.callMain(flags.concat(filter));

  // calling main closes stdout, so we reopen it here:
  FS.streams[1] = FS.open("/dev/stdout", 577, 0);
  FS.streams[2] = FS.open("/dev/stderr", 577, 0);

  if (outBuffer.length) {
    return fromByteArray(outBuffer).trim();
  }

  if (errBuffer.length) {
    var errBufferContents = fromByteArray(errBuffer);
    var errString = errBufferContents;
    if (errString.indexOf(":") > -1) {
      var parts = errString.split(":");
      errString = parts[parts.length - 1].trim();
    }
    throw new Error(errString);
  }

  return "";
}

// takes an object as input and tries to return objects.
function json(inputJson, filter) {
  if (!initialized) {
    return {};
  }

  var jsonstring = JSON.stringify(inputJson);
  var result = raw(jsonstring, filter, ["-c"]).trim();

  if (result.indexOf("\n") !== -1) {
    return (
      result
        .split("\n")
        // Filter any results that are empty in string form
        .filter(function(line) {
          return line;
        })
        // Parse each line to json
        .map(function(line) {
          return parseResult(line, "multi", inputJson, filter);
        })
        // Filter any results that returned null from parseResult
        .filter(function(parsedJson) {
          return parsedJson;
        })
        // Merge each json line into an array
        .reduce(function(acc, parsedJson) {
          return acc.concat(parsedJson);
        }, [])
    );
  } else {
    return parseResult(result, "single", inputJson, filter);
  }
}

function parseResult(jsonString, type, inputJson, filter) {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    var errorMsg = "JQ library error: " + e.message;
    window.Rollbar &&
      window.Rollbar.error(errorMsg, {
        json: inputJson,
        filter: filter,
        jqResultString: jsonString,
        stacktrace: e.stacktrace,
        type: type,
        memoryInfo: window.performance.memory
      });
    return null;
  }
}

jq.json = json;
jq.raw = raw;

jq.onInitialized = {
  addListener: function(cb) {
    if (initialized) {
      cb();
    }
    initListeners.push(cb);
  }
};

jq.promised = {};
jq.promised.json = function() {
  var args = arguments;
  return new Promise(function(resolve, reject) {
    jq.onInitialized.addListener(function() {
      try {
        resolve(jq.json.apply(jq, args));
      } catch (e) {
        reject(e);
      }
    });
  });
};
jq.promised.raw = function() {
  var args = arguments;
  return new Promise(function(resolve, reject) {
    jq.onInitialized.addListener(function() {
      try {
        resolve(jq.raw.apply(jq, args));
      } catch (e) {
        reject(e);
      }
    });
  });
};
