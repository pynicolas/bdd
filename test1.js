//var SERVER = "http://192.168.1.69:9000/";
var SERVER = "http://sonarqube.com/";

function onError(e) {
  console.log("Error!!");
}

function Project(projectKey) {
  var key = projectKey;
  var files = [];
  var filesByFileKey = {};
  var filesBySubProjectKey = {};
  var subProjectKeys = {};
  var duplications = {};
  this.addFile = function (file) {
    files.push(file);
    subProjectKeys[file.subProjectKey] = 1;
    var subProjectFiles = filesBySubProjectKey[file.subProjectKey];
    if (!subProjectFiles) {
      subProjectFiles = [];
      filesBySubProjectKey[file.subProjectKey] = subProjectFiles;
    }
    subProjectFiles.push(file);
    filesByFileKey[file.key] = file;
  }

  this.getFiles = function () {
    return files;
  }

  this.getFilesBySubProjectKey = function () {
    return filesBySubProjectKey;
  }

  this.getDuplications = function () {
    return duplications;
  }

  var fileByFileKey = function (fileKey) {
    return filesByFileKey[fileKey];
  }
  this.addDuplication = function (fileKey1, fileKey2, numberOfLines) {
    var file1 = fileByFileKey(fileKey1);
    var file2 = fileByFileKey(fileKey2);

    if (!file1 || !file2) {
      return;
    }

    var duplication = new Duplication(file1, file2, numberOfLines);
    var existingDuplication = duplications[duplication.key()];
    if (existingDuplication) {
      existingDuplication.add(numberOfLines)
      duplication = existingDuplication;
    }
    duplications[duplication.key()] = duplication;
  }
  this.numberOfFiles = function () {
    return files.length;
  }
}

function File(fileKey, numberOfDuplicatedLines) {
  this.key = fileKey;
  this.numberOfDuplicatedLines = numberOfDuplicatedLines;
  this.subProjectKey = fileKey.substring(0, fileKey.lastIndexOf(':'));
}

function Duplication(f1, f2, numberOfLines) {
  var file1 = f1;
  var file2 = f2;
  var numberOfLines = numberOfLines;
  this.key = function () {
    var result = compare(file1.key, file2.key);
    return result.min + '-' + result.max;
  }
  this.add = function (additionalNumberOfLines) {
    numberOfLines += additionalNumberOfLines;
  }

  var self = this;
  this.toString = function () {
    return file1 + '^^^' + file2 + '^^^' + numberOfLines;
  }

  this.getFile1 = function () {
    return file1;
  }
  this.getFile2 = function () {
    return file2;
  }
  this.getNumberOfLines = function () {
    return numberOfLines / 2;
  }
}

function SubProjectDuplication(k1, k2, numberOfLines) {
  this.k1 = k1;
  this.k2 = k2;
  var numberOfLines = numberOfLines;
  this.key = function () {
    var result = compare(k1, k2);
    return result.min + '-' + result.max;
  }
  this.add = function (additionalNumberOfLines) {
    numberOfLines += additionalNumberOfLines;
  }

  var self = this;
  this.toString = function () {
    return k1 + '^^^' + k2 + '^^^' + numberOfLines;
  }

  this.getNumberOfLines = function () {
    return numberOfLines;
  }
}

var nodeKeys = {};
var edges = {};

var groups = [];

var graphNodes = new vis.DataSet([]);
var graphEdges = new vis.DataSet([]);


var network = null;

function getProjectFilesWithDuplicatedLines(projectKey) {
  var project = new Project(projectKey);
  var onLoad = function () {
    var response = JSON.parse(this.responseText);
    var files = response.components;

    var responseCounts = 0;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];

      var numberOfDuplicatedLines = file.measures[0].value;
      if (numberOfDuplicatedLines == 0) {
        continue;
      }

      var projectFile = new File(file.key, numberOfDuplicatedLines);
      project.addFile(projectFile);

      function fetchDuplications(fromKey) {
        return function () {
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
          if (project.numberOfFiles() == responseCounts) {
            displayGraph(project);
          }
        }


      }

      sendQuery('api/duplications/show', { 'key': file.key }, fetchDuplications(file.key));
    }
  }

  var qp = {
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

  sendQuery('api/measures/component_tree', qp, onLoad);
}

function compare(a, b) {
  if (a < b) {
    return { min: a, max: b };
  }
  return { min: b, max: a };
}


function displayGraph(project) {
  var nodes = [];
  var edges = [];
  var filesBySubProjectKey = project.getFilesBySubProjectKey();
  for (var subProjectKey in filesBySubProjectKey) {
    if (filesBySubProjectKey.hasOwnProperty(subProjectKey)) {
      var files = filesBySubProjectKey[subProjectKey];
      var subProjectValue = 0;
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        subProjectValue += file.numberOfDuplicatedLines;
      }
      nodes.push({ id: subProjectKey, 'group': subProjectKey, title: subProjectKey, value: subProjectValue });
    }
  }

  var subProjectDuplications = {};

  var duplications = project.getDuplications();
  for (duplicationKey in duplications) {
    if (duplications.hasOwnProperty(duplicationKey)) {
      var duplication = duplications[duplicationKey];
      var s1 = duplication.getFile1().subProjectKey;
      var s2 = duplication.getFile2().subProjectKey;
      if (s1 == s2) {
        continue;
      }
      var sbd = new SubProjectDuplication(s1, s2, duplication.getNumberOfLines());
      var existingDuplication = subProjectDuplications[sbd.key()];
      if (existingDuplication) {
        sbd.add(existingDuplication.getNumberOfLines);
      } else {
        subProjectDuplications[sbd.key()] = sbd;
      }
    }
  }
  for (duplicationKey in subProjectDuplications) {
    if (subProjectDuplications.hasOwnProperty(duplicationKey)) {
      var duplication = subProjectDuplications[duplicationKey];
      edges.push({ from: duplication.k1, to: duplication.k2, value: duplication.getNumberOfLines() });
    }
  }

  /*
    var files = project.getFiles();
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      nodes.push({ id: file.key, 'group': file.subProjectKey, title: file.key, value: file.numberOfDuplicatedLines });
    }
  
    var duplications = project.getDuplications();
    for (duplicationKey in duplications) {
      if (duplications.hasOwnProperty(duplicationKey)) {
        var duplication = duplications[duplicationKey];
        edges.push({ from: duplication.getFile1().key, to: duplication.getFile2().key, value: duplication.getNumberOfLines() });
      }
    }
    */

  var data = {
    nodes: nodes,
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
        gravitationalConstant: -60000,
        springConstant: 0.02
      }
    }
  };
  network = new vis.Network(container, data, options);
  network.on("selectNode", function (params) {
    if (params.nodes.length == 1) {
      var subProjectKey = params.nodes[0];
      if (project.getFilesBySubProjectKey().hasOwnProperty(subProjectKey)) {

        network.destroy();

        displayHalfExplodedGraph(project, subProjectKey, subProjectDuplications);
      }

    }
  });

  // clusterAll();
}

function displayHalfExplodedGraph(project, spk, subProjectDuplications) {
  var nodes = [];
  var edges = [];
  var filesBySubProjectKey = project.getFilesBySubProjectKey();
  for (var subProjectKey in filesBySubProjectKey) {
    if (filesBySubProjectKey.hasOwnProperty(subProjectKey)) {
      if (spk != subProjectKey) {
        var files = filesBySubProjectKey[subProjectKey];
        var subProjectValue = 0;
        for (var i = 0; i < files.length; i++) {
          var file = files[i];
          subProjectValue += file.numberOfDuplicatedLines;
        }
        nodes.push({ id: subProjectKey, 'group': subProjectKey, title: subProjectKey, value: subProjectValue });
      } else {
        var files = filesBySubProjectKey[spk];
        for (var i = 0; i < files.length; i++) {
          var file = files[i];
          nodes.push({ id: file.key, 'group': file.subProjectKey, title: file.key, value: file.numberOfDuplicatedLines });
        }
      }
    }
  }

  var subProjectDuplications = {};

  var duplications = project.getDuplications();
  for (duplicationKey in duplications) {
    if (duplications.hasOwnProperty(duplicationKey)) {
      var duplication = duplications[duplicationKey];
      var s1 = duplication.getFile1().subProjectKey;
      var s2 = duplication.getFile2().subProjectKey;
      if (s1 == s2) {
        continue;
      }
      var sbd = new SubProjectDuplication(s1, s2, duplication.getNumberOfLines());
      var existingDuplication = subProjectDuplications[sbd.key()];
      if (existingDuplication) {
        sbd.add(existingDuplication.getNumberOfLines);
      } else {
        subProjectDuplications[sbd.key()] = sbd;
      }
    }
  }

  for (duplicationKey in subProjectDuplications) {
    if (subProjectDuplications.hasOwnProperty(duplicationKey)) {
      var duplication = subProjectDuplications[duplicationKey];
      if (duplication.k1 != spk && duplication.k2 != spk) {
        edges.push({ from: duplication.k1, to: duplication.k2, value: duplication.getNumberOfLines() });
      }
    }
  }

  var duplications = project.getDuplications();
  var dict = {};
  for (duplicationKey in duplications) {
    if (duplications.hasOwnProperty(duplicationKey)) {
      var duplication = duplications[duplicationKey];
      if (duplication.getFile1().subProjectKey == spk &&
        duplication.getFile2().subProjectKey == spk) {
        edges.push({ from: duplication.getFile1().key, to: duplication.getFile2().key, value: duplication.getNumberOfLines() });
      } else {
        var otherSubProject = null;
        var file = null;
        if (duplication.getFile1().subProjectKey == spk) {
          otherSubProject = duplication.getFile2().subProjectKey;
          file = duplication.getFile1().key;
        } else {
          otherSubProject = duplication.getFile1().subProjectKey;
          file = duplication.getFile2().key;
        }

        var sbd = new SubProjectDuplication(otherSubProject, file, duplication.getNumberOfLines());
        var existingDuplication = dict[sbd.key()];
        if (existingDuplication) {
          sbd.add(existingDuplication.getNumberOfLines);
        } else {
          dict[sbd.key()] = sbd;
        }
      }
    }
  }

  for (duplicationKey in dict) {
    if (dict.hasOwnProperty(duplicationKey)) {
      var duplication = dict[duplicationKey];
      edges.push({ from: duplication.k1, to: duplication.k2, value: duplication.getNumberOfLines() });
    }
  }

  var container = document.getElementById('container');
  var data = {
    nodes: nodes,
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
        centralGravity: 0.5,
        //        gravitationalConstant: -500,
        //        springConstant: 0.01
      }
    }
  };
  network = new vis.Network(container, data, options);
  network.on("selectNode", function (params) {
    if (params.nodes.length == 1) {
      var subProjectKey = params.nodes[0];
      if (project.getFilesBySubProjectKey().hasOwnProperty(subProjectKey)) {

        network.destroy();

        displayHalfExplodedGraph(project, subProjectKey, subProjectDuplications);
      }

    }
  });

}

function clusterAll() {
  for (var i = 0; i < groups.length; i++) {
    var currentGroup = groups[i];
    doCluster(currentGroup);
  }
}

function doCluster(currentGroup) {
  var clusterOptionsByData = {
    joinCondition: function (childOptions) {
      return childOptions.group == currentGroup;
    },
    processProperties: function (clusterOptions, childNodes, childEdges) {
      var totalMass = 0;
      for (var i = 0; i < childNodes.length; i++) {
        totalMass += childNodes[i].value;
        clusterOptions.color = childNodes[i].color;
      }
      clusterOptions.value = totalMass;
      return clusterOptions;
    },
    clusterNodeProperties: { id: 'cluster:' + currentGroup, borderWidth: 3, shape: 'dot', title: currentGroup, label: '' }
  };
  network.cluster(clusterOptionsByData);
}

function sendQuery(baseWs, parameter, callback) {
  var url = SERVER + baseWs;

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


window.onload = function () {
  getProjectFilesWithDuplicatedLines('org.sonarsource.java:java');
  //getProjectFilesWithDuplicatedLines('sa-dotnet');
  //getProjectFilesWithDuplicatedLines('org.sonarsource.sonarqube:sonarqube');
}