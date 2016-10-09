function onError(e) {
  console.log("Error!!");
}

function Project(projectKey) {
  this.key = projectKey;
  this.files = [];
  this.duplications = [];

  var isInProject = function (fileKey) {
    return fileKey.startsWith(projectKey);
  };

  this.addFile = function (fileKey, numberOfDuplicatedLines) {
    this.files.push({ key: fileKey, numberOfDuplicatedLines: +numberOfDuplicatedLines });
  };

  this.addDuplication = function (fileKey1, fileKey2, numberOfLines) {
    if (!isInProject(fileKey1) || !isInProject(fileKey2) || fileKey1 != fileKey2) {
      this.duplications.push({ file1: fileKey1, file2: fileKey2, numberOfLines: numberOfLines });
    }
  };
}

function loadProject(server, projectKey) {
  var project = new Project(projectKey);
  var responseCounts = 0;

  var fetchDuplications = function (fromKey) {
    sendQuery(server, 'api/duplications/show', { 'key': fromKey }, function () {
      responseCounts++;
      var edgeResponse = JSON.parse(this.responseText);
      var fileKeysByRef = {};
      for (var fileRef in edgeResponse.files) {
        fileKeysByRef[fileRef] = edgeResponse.files[fileRef].key;
      }
      for (var d in edgeResponse.duplications) {
        var blocks = edgeResponse.duplications[d].blocks;
        for (var i = 0; i < blocks.length; i++) {
          var block = blocks[i];
          var fileKey = fileKeysByRef[block._ref];
          if (fileKey != fromKey) {
            var numberOfLinesInBlock = block.size;
            project.addDuplication(fromKey, fileKey, numberOfLinesInBlock);
          }
        }
      }
      if (project.files.length == responseCounts) {
        displayGraph(project, null);
      }
    });
  }

  var params = {
    asc: false,
    ps: 200,
    metricSortFilter: 'withMeasuresOnly',
    p: 1,
    s: 'metric,name',
    metricSort: 'duplicated_lines',
    metricKeys: 'duplicated_lines',
    strategy: 'leaves',
    baseComponentKey: projectKey
  };

  sendQuery(server, 'api/measures/component_tree', params, function () {
    var response = JSON.parse(this.responseText);
    var files = response.components;
    var responseCounts = 0;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var numberOfDuplicatedLines = file.measures[0].value;
      if (numberOfDuplicatedLines == 0) {
        continue;
      }
      project.addFile(file.key, numberOfDuplicatedLines);
    }

    for (var i = 0; i < project.files.length; i++) {
      fetchDuplications(project.files[i].key);
    }
  });
}

function getSubProjectKey(fileKey) {
  return fileKey.substring(0, fileKey.lastIndexOf(':'));
}

function displayGraph(project, subProjectKey) {
  var mapKey = function (fileKey) {
    return (subProjectKey && fileKey.startsWith(subProjectKey)) ? fileKey : getSubProjectKey(fileKey);
  }

  var nodes = [];
  var nodeIndexByKey = {};
  var files = project.files;
  var fileNodeColor = '#6699ee';
  var groupNodeColor = '#bbccee';
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var key = mapKey(file.key);
    if (nodeIndexByKey.hasOwnProperty(key)) {
      nodes[nodeIndexByKey[key]].value += file.numberOfDuplicatedLines;
    } else {
      var isFileNode = file.key == key;
      var mass = isFileNode ? 1 : 2;
      var color = isFileNode ? fileNodeColor : groupNodeColor;
      var name = key.substring(key.lastIndexOf(':') + 1);
      var label = name.lastIndexOf('/') > -1 ? name.substring(name.lastIndexOf('/') + 1) : name;
      nodes.push({ id: key, 'group': getSubProjectKey(file.key), title: name, label: label, value: file.numberOfDuplicatedLines, mass: mass, color: color });
      nodeIndexByKey[key] = nodes.length - 1;
    }
  }

  var edges = [];
  var edgeIndexByKey = {};
  var duplications = project.duplications;
  for (var i = 0; i < duplications.length; i++) {
    var duplication = duplications[i];
    var key1 = mapKey(duplication.file1);
    var key2 = mapKey(duplication.file2);
    if (key1 == key2) {
      continue;
    }

    if (!nodeIndexByKey.hasOwnProperty(key2)) {
      // cross-project duplication
      var otherProjectKey = key2.substring(0, key2.indexOf(':'));
      if (!nodeIndexByKey.hasOwnProperty(otherProjectKey)) {
        nodes.push({ id: otherProjectKey, label: otherProjectKey, value: 10, mass: 2.5, color: '#cccccc' });
        nodeIndexByKey[otherProjectKey] = nodes.length - 1;
      }
      key2 = otherProjectKey;
    }
    var duplicationKey = key1 > key2 ? key1 + '-' + key2 : key2 + '-' + key1;
    if (edgeIndexByKey.hasOwnProperty(duplicationKey)) {
      edges[edgeIndexByKey[duplicationKey]].value += duplication.numberOfLines;
    } else {
      console.log(duplicationKey);
      edges.push({ id: duplicationKey, from: key1, to: key2, value: duplication.numberOfLines });
      edgeIndexByKey[duplicationKey] = edges.length - 1;
    }
  }

  var nodeSet = new vis.DataSet(nodes, {});
  var data = {
    nodes: nodeSet,
    edges: edges
  };
  var options = {
    layout: {
      improvedLayout: false
    },
    nodes: {
      shape: 'dot'
    },
    physics: {
      barnesHut: {
        //centralGravity: 0.5,
        gravitationalConstant: -1000,
        springConstant: 0.02
      }
    }
  };
  var network = new vis.Network(document.getElementById('container'), data, options);
  network.on("selectNode", function (params) {
    if (params.nodes.length == 1) {
      var nodeId = params.nodes[0];
      var node = nodeSet.get(nodeId);
      network.destroy();
      displayGraph(project, node.group == node.id ? node.group : null);
    }
  });
  document.getElementById('graph-title').innerText = subProjectKey ? subProjectKey : project.key;
}

function sendQuery(server, baseWs, parameter, callback) {
  var url = server + baseWs;

  if (parameter != null) {
    var queryString = [];
    for (var property in parameter) {
      if (parameter.hasOwnProperty(property)) {
        queryString.push(property + '=' + encodeURI(parameter[property]));
      }
    }

    queryString = queryString.join('&');
    url += '?' + queryString
  }

  var cached = localStorage.getItem(url);
  if (cached) {
    callback.bind({ responseText: cached })();
    return;
  }

  var cachingCallback = function () {
    localStorage.setItem(url, this.responseText);
    callback.bind(this)();
  };

  var req = new XMLHttpRequest();
  req.open("GET", url, true);
  req.onload = cachingCallback;
  req.onerror = onError;
  req.send(null);
}
