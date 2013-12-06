'use strict';

var cluster = require('cluster');

module.exports = function(instanceId, logger, workerProcesses, runCallback, onSyncCallback) {
  var isClusterMaster = (cluster.isMaster && (workerProcesses > 1));
  var signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  var runtimeConfig = require('./configManager').runtime('m'+instanceId);
  
  if (isClusterMaster) {
    logger.info("Starting app in clustered mode");
    var timeouts = [];
    for (var i = 0; i < workerProcesses; i++) {
      cluster.fork();
    }

    cluster.on('fork', function forkingWorker(worker) {
      logger.debug('Forking worker #' + worker.id);
      timeouts[worker.id] = setTimeout(function workerTimingOut() {
        logger.error(['Worker taking too long to start']);
      }, 2000);
    });

    cluster.on('listening', function onClusterListening(worker, address) {
      logger.info('Worker #' + worker.id + ' listening on port: ' + address.port);
      clearTimeout(timeouts[worker.id]);
      //handle runtime config
      worker.on('message', function(msg) {
        runtimeConfig.set(msg.key, msg.value);
        Object.keys(cluster.workers).forEach(function(id) {
          cluster.workers[id].send(msg);
        });
      });
    });

    cluster.on('online', function onClusterOnline(worker) {
      logger.debug('Worker #'+worker.id+' is online');
    });

    cluster.on('exit', function onClusterExit(worker, code, signal) {
      logger.info('The worker #'+worker.id+' has exited with exitCode ' + worker.process.exitCode);
      clearTimeout(timeouts[worker.id]);
      // Don't try to restart the workers when disconnect or destroy has been called
      if(worker.suicide !== true) {
        logger.warning('Worker #' + worker.id + ' did not commit suicide, restarting');
        cluster.fork();
      }
    });

    cluster.on('disconnect', function onClusterDisconnect(worker) {
      logger.warning('The worker #' + worker.id + ' has disconnected');
    });

    signals.forEach(function forEachQuitSignal(signal){
      process.once(signal, function onQuitSignals() {
        logger.info('Shutting down cluster..');
        cluster.disconnect();
        //_.each(cluster.workers, function destroyWorker(worker){ worker.destroy(); });
      });
    });
    process.once('exit', function onExit(){
      runtimeConfig.save();
      logger.info('Runtime config saved. Exiting from master node.');
    });
    
  } else {
    if (workerProcesses == 1) {
      signals.forEach(function forEachQuitSignal(signal){
        process.once(signal, process.exit);
      });
      process.once('exit', function onExit(){
        runtimeConfig.save();
        logger.info('Exiting from normal node');
      });
    } else {
      runtimeConfig.set = function(key, value) {
        this.config[key] = value;
        process.send({key:key, value:value});
      }
      runtimeConfig.save = function(){};
      process.on('message', function(msg) {
        runtimeConfig.config[msg.key] = msg.value;
        onSyncCallback(msg.key, msg.value);
      });
    }
    
    runCallback(runtimeConfig);
  }
}

