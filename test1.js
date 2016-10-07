var SERVER = "http://192.168.1.69:9000/";
//var SERVER = "http://sonarqube.com/";

function onError(e) {
  console.log("Error!!");
}


var nodeKeys = {};
var edges = {};

var groups = [];

var graphNodes = new vis.DataSet([]);
var graphEdges = new vis.DataSet([]);


var network = null;

function getProjectFilesWithDuplicatedLines(projectKey) {
  var onLoad = function () {
    var response = JSON.parse(this.responseText);
    var files = response.components;

    var responseCounts = 0;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];

      if (file.measures[0].value == 0) {
        continue;
      }

      var group = file.key.substring(0, file.key.lastIndexOf(':') - 1);
      groups.push(group);
      graphNodes.add({ id: file.key, 'group': group, title: file.key, value: file.measures[0].value });
      nodeKeys[file.key] = 1;

      sendQuery('api/duplications/show', { 'key': file.key }, function (fromKey) {
        return function () {
          responseCounts++;
          var edgeResponse = JSON.parse(this.responseText);
          for (var property in edgeResponse.files) {
            if (edgeResponse.files.hasOwnProperty(property) &&
              nodeKeys.hasOwnProperty(edgeResponse.files[property].key) &&
              edgeResponse.files[property].key != fromKey) {

              var c = compare(edgeResponse.files[property].key, fromKey);

              if (!graphEdges.hasOwnProperty(c.min)) {
                graphEdges[c.min] = {};

              }

              if (!graphEdges[c.min].hasOwnProperty(c.max)) {
                graphEdges[c.min][c.max] = 1;
                graphEdges.add({ to: edgeResponse.files[property].key, from: fromKey });
              }
            }
          }

          if (graphNodes.length == responseCounts) {
            displayGraph(graphNodes, graphEdges);
          }
        }
      } (file.key));
    }
  }

  var qp = {
    asc: false,
    ps: 500,
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


function displayGraph(nodes, edges) {
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
    physics:{
       barnesHut:{
         gravitationalConstant: -60000,
         springConstant:0.02
       }
     }
  };
  network = new vis.Network(container, data, options);
  network.on("selectNode", function(params) {
      if (params.nodes.length == 1) {
          if (network.isCluster(params.nodes[0]) == true) {
            clusterAll();
            network.openCluster(params.nodes[0]);
          }
      }
  });

  clusterAll();
}

function clusterAll(){
  for (var i = 0; i < groups.length; i++) {
    var currentGroup = groups[i];
    doCluster(currentGroup);
  }
}

function doCluster(currentGroup){
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

  var req = new XMLHttpRequest();
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

  req.open("GET", url, true);
  req.onload = callback;
  req.onerror = onError;
  req.send(null);
}


//getDuplicationsByUuid("AVPu5O1a_WSHCtbxw-SI");
getProjectFilesWithDuplicatedLines('sa-dotnet');
