// js/app.js

// Global variables
let connectionParams = {};
let globalData = [];
let columns = [];
let currentChart = null; // Chart.js instance

// Backend API base URL (adjust to your Web API URL)
const apiBaseUrl = "https://localhost:44344";

$(document).ready(function(){

  // Bağlantıyı Test Et
  $("#testConnectionBtn").click(function(){
    // Her yeni denemede arayüz sıfırla
    $("#connectionResult").text("");
    $("#dataSourceSelect").empty();
    $("#chartConfigCard").hide();
    $("#mappingCard").hide();

    connectionParams = {
      ServerName: $("#serverName").val(),
      DatabaseName: $("#databaseName").val(),
      UserName: $("#userName").val(),
      Password: $("#password").val()
    };

    $.ajax({
      url: apiBaseUrl + "/api/Connection/TestConnection",
      method: "POST",
      contentType: "application/json",
      data: JSON.stringify(connectionParams),
      success: function(res){
        // Bağlantı başarılı
        $("#connectionResult").text(res.message || "Bağlantı başarılı!");
        $("#dataSourceCard").show();
      },
      error: function(err){
        let msg = "Bağlantı başarısız!";
        if(err.responseJSON && err.responseJSON.message){
          msg = err.responseJSON.message;
        }
        $("#connectionResult").text(msg);
      }
    });
  });

  // Veri Kaynaklarını Listele
  $("#loadDataSourcesBtn").click(function(){
    $.ajax({
      url: apiBaseUrl + "/api/Metadata/GetDataSources",
      method: "POST",
      contentType: "application/json",
      data: JSON.stringify(connectionParams),
      success: function(list){
        $("#dataSourceSelect").empty();
        $.each(list, function(i, item){
          // item.name => tablo/view/sp adı
          // item.objectType => "Table", "View", "StoredProcedure", "Function" ...
          const opt = $("<option></option>")
            .val(item.name)
            .text(item.name + " (" + item.objectType + ")")
            .attr("data-type", item.objectType);
          $("#dataSourceSelect").append(opt);
        });
        // Chart tipi seçimi paneli açalım
        $("#chartConfigCard").show();
      },
      error: function(err){
        alert("GetDataSources Hatası: " + JSON.stringify(err));
      }
    });
  });

  // Veriyi Getir
  $("#getDataBtn").click(function(){
    const selectedOpt = $("#dataSourceSelect option:selected");
    const dataSourceName = selectedOpt.val();
    const objectType = selectedOpt.attr("data-type"); // tablo mu sp mi?

    const requestBody = {
      connectionParameters: connectionParams,
      dataSourceName: dataSourceName,
      objectType: objectType, // Sunucu tablo mu sp mi bilsin
      parameters: {}
    };

    $.ajax({
      url: apiBaseUrl + "/api/ChartData/GetData",
      method: "POST",
      contentType: "application/json",
      data: JSON.stringify(requestBody),
      success: function(res){
        globalData = res.records || [];
        if(globalData.length > 0){
          columns = Object.keys(globalData[0]);
        } else {
          columns = [];
        }

        // Kolon dropdownlarını dolduralım
        $("#labelColumnSelect").empty();
        $("#valueColumnSelect").empty();

        columns.forEach(col => {
          $("#labelColumnSelect").append(
            $("<option></option>").val(col).text(col)
          );
          $("#valueColumnSelect").append(
            $("<option></option>").val(col).text(col)
          );
        });

        $("#columnList").text(columns.join(", "));
        $("#mappingCard").show();
      },
      error: function(err){
        alert("GetData Hatası: " + JSON.stringify(err));
      }
    });
  });

  // Chart Çiz
  $("#drawChartBtn").click(function(){
    if(globalData.length === 0){
      alert("Önce veri çekmelisiniz!");
      return;
    }
    const labelCol = $("#labelColumnSelect").val();
    const valueCol = $("#valueColumnSelect").val();
    const chartType = $("#chartTypeSelect").val();

    const labels = globalData.map(row => row[labelCol]);
    const dataValues = globalData.map(row => row[valueCol]);

    // Önce eski chart varsa destroy
    if(currentChart){
      currentChart.destroy();
    }

    const ctx = document.getElementById("myChart").getContext("2d");
    currentChart = new Chart(ctx, {
      type: chartType,
      data: {
        labels: labels,
        datasets: [{
          label: "Değer",
          data: dataValues,
          backgroundColor: "rgba(75, 192, 192, 0.4)",
          borderColor: "rgba(75, 192, 192, 1)",
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  });

  // Chart Temizle
  $("#clearChartBtn").click(function(){
    if(currentChart){
      currentChart.destroy();
      currentChart = null;
    }
    // Gerekirse globalData vb. de sıfırlayabilirsiniz
    // globalData = [];
    // $("#mappingCard").hide();
    // $("#columnList").text("");
  });
});
