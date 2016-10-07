//var SERVER = "http://192.168.1.50:9000/";
var SERVER = "http://sonarqube.com/";

/*
function getProjects() {
  var req = new XMLHttpRequest();
  req.open('GET', SERVER + 'api/projects/index', false);
  req.send(null);
  if (req.status == 200)
    console.log(req.responseText);
}
*/

function onError(e) {
  console.log("Error!!");
}

function getDuplicationsByUuid(uuid) {
  var onLoad = function () {
    console.log(this.responseText);
  }
  var uri = 'api/duplications/show?uuid=' + uuid;
  sendQuery(uri, onLoad);
}

function getProjectFilesWithDuplicatedLines(projectKey) {
  var onLoad = function () {
    var response = JSON.parse(this.responseText);
    var files = response.components;
    for(var i = 0; i < files.length; i++) {
      var file = files[i];
      console.log(file.key + ': ' + file.measures[0].value);
    }
    document.getElementById('container').innerText = this.responseText;
  }
  var uri = 'api/measures/component_tree?asc=false&ps=5&metricSortFilter=withMeasuresOnly&p=1&s=metric,name&metricSort=duplicated_lines&metricKeys=duplicated_lines&strategy=leaves&&baseComponentKey=' + projectKey;
  sendQuery(uri, onLoad);
}

function sendQuery(uri, callback) {
  var req = new XMLHttpRequest();
  var url = SERVER + uri;
  req.open("GET", url, true);
  req.onload = callback;
  req.onerror = onError;
  req.send(null);
}


//getDuplicationsByUuid("AVPu5O1a_WSHCtbxw-SI");
getProjectFilesWithDuplicatedLines('org.sonarsource.sonarqube%3Asonarqube');