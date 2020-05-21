var path 	= require('path');
var fs 		= require('fs');
var os 		= require('os')
var spawn 	= require('child_process').spawn;

function walk(dir) {
  return new Promise((resolve, reject) => {
	fs.readdir(dir, (error, files) => {
	  if (error) {
		return reject(error);
	  }
	  Promise.all(files.map((file) => {
		return new Promise((resolve, reject) => {
		  const filepath = path.join(dir, file);
		  fs.stat(filepath, (error, stats) => {
			if (error) {
			  return reject(error);
			}
			if (stats.isDirectory()) {
			  walk(filepath).then(resolve);
			} else if (stats.isFile()) {
			  resolve(filepath);
			}
		  });
		});
	  }))
	  .then((foldersContents) => {
		resolve(foldersContents.reduce((all, folderContents) => all.concat(folderContents), []));
	  });
	});
  });
}

function bigCopy(from, to, options) {
	options = options || {};
	options.overwrite 		= options.overwrite || false;
	options.filter 			= options.filter  || function(){return true}
	options.onBeforeCopy	= options.onBeforeCopy || function(){};
	options.onAfterCopy		= options.onAfterCopy || function(){};
	options.useShell 		= options.useShell || false // use system copy if possible
	
	
	return new Promise((resolve, reject) => {
		
		if (Boolean(options.filter(from, to)) == false) return resolve();
		
		if (options.overwrite == false) {
			var promiseToHalt =  new Promise((resolve, reject) => {
				fs.stat(to, (error, stats) => {
					if (error) {
						resolve(false);
						return;
					}
					
					if (stats.isFile()) resolve(true);
					resolve(false);
				})
			})
		} else {
			var promiseToHalt = new Promise((resolve, reject) => {
				resolve(false);
			})
		}
		
		promiseToHalt.then((isHalt) => {
			if (isHalt) {
				resolve(); // resolve without giving path
				return;
			}
			
			fs.mkdir(path.dirname(to), {recursive:true}, (err)=>{
				if (err) reject(err);
				
				var readable = fs.createReadStream(from);
				var writable = fs.createWriteStream(to);
				// All the data from readable goes into 'file.txt'.
				options.onBeforeCopy.call(this, from, to)

				// Shell Command
				var shellCommand;
				if (options.useShell) {
					if (os.platform == 'win32' || os.platform == 'win64') {
						shellCommand = {
							command: "copy",
							args: [from, to, '/y']
						}
					}
				}

				
				if (shellCommand) {	
					var ls = spawn(shellCommand.command, shellCommand.args, {shell:true});

					ls.stdout.on('data', (data) => {
						//console.log(`stdout: ${data}`, from, to);
					});

					ls.stderr.on('data', (data) => {
						console.error(`stderr: ${data}`);
					});

					ls.on('close', (code) => {
						resolve({
							from:from,
							to:to});
						options.onAfterCopy.call(this, from, to)						
					});	
					
				} else {				
					readable.pipe(writable);
					readable.on('end', () => {
						writable.end();
						resolve({
							from:from,
							to:to});
						options.onAfterCopy.call(this, from, to)
					})	
				}
			})				
		})

	})
}

function copyDir(from, to, options) {
	options = options || {}
	options.overwrite = options.overwrite || false;
	to = path.normalize(to);
	
	return new Promise((resolve, reject) => {
		walk(from)
		.then((dirContent) => {
			var promises = []
			var targetFiles = [];
			var resultPairs = {};
			for (var i=0; i<dirContent.length; i++) {
				var sourceFile = dirContent[i];
				var targetFile = path.join(to, sourceFile.substring(from.length, sourceFile.length))
				targetFiles.push(targetFile);
				promises.push(bigCopy(sourceFile, targetFile, options)
				.then((result) => {
					if (!result) return;
					resultPairs[result.from] = resultPairs[result.from] || [];
					resultPairs[result.from].push(result.to);
				}))
			}
			
			return Promise.all(promises)
			.then(()=> {
				resolve(resultPairs)
			});
		})
	});
}

function isDirectoryString(string, filter) {
	/*
	 determine whether the string is a directory string
	 string is a directory if one of the following conditions are met :
	 ended with directory separator character "/" or "\"
	 the actual string is a directory
	 normal path without any "." on the filename
	 if filename on the string does not match filename on filter
	*/
	
	filter = filter||"";
	string = path.normalize(string);
	if (string[string.length-1] == "\\") return true;
	
	if (path.basename(string) == path.basename(filter)) return false;
	try {
		if(fs.statSync(string).isDirectory()) return true;
	} catch(e) {
	}
	if (path.basename(string).includes(".") == false) return true;
	
	return false;
}

function copy(origins, targets, options, callback) {
	options = options || {};
	callback = callback || function() {}
	if (typeof callback !== 'function') callback = function() {}
	if (Array.isArray(origins) == false) origins = [origins];
	if (Array.isArray(targets) == false) targets = [targets];
	
	var promises = [];
	var RESULTS = {};
	for (var i=0; i<origins.length; i++) {
		// determine if thisFile is a directory or a file
		for (var x=0; x<targets.length; x++) {
			promises.push(
				new Promise((resolve, reject) => {
					var thisFile 	= origins[i];
					var thisTarget 	= targets[x];
					fs.stat(thisFile, (error, stats) => {
						if (error) {
							reject();
							return;
						}
						stats.from 	= thisFile;
						stats.to 	= thisTarget;
						
						if (!Boolean(stats)) {
							return resolve();
						}
						
						if (stats.isFile()) {
							// if path is a directory string, automatically assign name
							if (isDirectoryString(stats.to)) stats.to = path.join(stats.to, path.basename(stats.from))
							bigCopy(stats.from, stats.to, options)
							.then((result) => {
								if (!Boolean(result)) return resolve();
								RESULTS[result.from] = RESULTS[result.from] || [];
								RESULTS[result.from].push(result.to);
								resolve();
							})
						} else if (stats.isDirectory()){
							copyDir(stats.from, stats.to, options)
							.then((result) => {
								if (!Boolean(result)) return resolve();
								RESULTS = {...RESULTS, ...result}
								resolve();
							});
							
						}	
						
						
						
					})
				})
				.then((stats) => {
					
				})
			);
		}
	}
	
	return new Promise((resolve, reject) => {
		Promise.all(promises).
		then(() => {
			callback.apply(this, [RESULTS]);
			resolve(RESULTS);
		})
	})
}



module.exports = copy;