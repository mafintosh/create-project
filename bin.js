#!/usr/bin/env node

var tar = require('tar-fs')
var gunzip = require('gunzip-maybe')
var request = require('request')
var minimist = require('minimist')
var format = require('streaming-format')
var read = require('read')
var fs = require('fs')
var path = require('path')

var CONFIG = path.join(process.env.HOME || process.env.USERPROFILE, '.config/create-project.json')

var conf = fs.existsSync(CONFIG) ? require(CONFIG) : {}
var argv = minimist(process.argv.slice(2), {alias:{configure:'c'}, boolean:'c'})

var dir = argv._[0]
var repo = argv._[1]
var name = dir && path.basename(dir)

var parse = function(str) {
  var branch = str.split('#')[1] || 'master'
  var parts = str.split('#')[0].replace(/\.git$/, '').split(/[:\/]/)

  if (parts.length < 2) return null

  var repo = parts.pop()
  var user = parts.pop()

  return {
    user: user,
    repo: repo,
    branch: branch
  }
}

if (argv.configure) {
  var defaults = conf.defaults || {}
  var keys = Object.keys(defaults)

  read({
    prompt: 'Set repository: ',
    default: conf.github && conf.github.user+'/'+conf.github.repo+'#'+conf.github.branch
  }, function(err, repo) {
    if (err) return

    if (!repo) {
      console.error('Repository is required')
      process.exit(1)
      return
    }

    repo = parse(repo)

    if (!repo) {
      console.error('Repository is malformed (should be user/repo(#branch)?)')
      process.exit(2)
      return
    }

    conf.github = repo
    conf.defaults = {}

    var store = function() {
      try {
        fs.mkdirSync(path.dirname(CONFIG))
      } catch (err) {
        // do nothing
      }
      fs.writeFileSync(CONFIG, JSON.stringify(conf, null, 2))
    }

    var loop = function() {
      read({
        prompt: 'Set key=value: ',
        default: keys.length ? keys[0]+'='+defaults[keys[0]] : 'blank to skip'
      }, function(err, def) {
        if (err) return
        if (def === 'blank to skip' || !def.trim()) return store()

        keys.shift()
        def = def.trim().split(/\s*=\s*/)

        var k = def[0].trim() || oldK
        var v = (def[1] || '').trim()

        if (v) conf.defaults[k] = v
        else delete conf.defaults[k]

        loop()
      })
    }

    loop()
  })
  return
}

var usage = function() {
  var def = conf.github ? conf.github.user+'/'+conf.github.repo+'#'+conf.github.branch : 'user/repo#branch'

  console.error('create-project [name] [%s]', def)
  console.error('')
  console.error('  --configure,-c  to set default repo/parameters')
  console.error('  --[key]=[val]   to pass format parameters')
  console.error('')

  var keys = Object.keys(conf.defaults || {})

  if (keys.length) {
    console.error('Default parameters are:')
    console.error()
    keys.forEach(function(key) {
      console.log('  %s=%s', key, conf.defaults[key])
    })
    console.error('')
  }

  process.exit(1)
}


var gzipStream, gzipSrc;

var failedHttp = function(response) {
  if (response.statusCode !== 200) {
    console.log('Fetch failed! Status code: '+response.statusCode)
    process.exit(4)
  }
}

if (argv.file) {
  gzipSrc = argv.file;
  gzipStream = fs.createReadStream(argv.file);
}
else if (argv.url) {
  gzipSrc = argv.url;
  gzipStream = request(argv.url)
  gzipStream.on('response', failedHttp)
} else {
  if (repo && repo.indexOf('/') === -1 && conf.github) repo = conf.github.user+'/'+conf.github.repo+'#'+repo

  if (repo) repo = parse(repo)
  else if (conf.github) repo = conf.github

  if (!repo || !name) return usage()

  gzipSrc = repo.user+'/'+repo.repo+'#'+repo.branch
  gzipStream = request('https://github.com/'+repo.user+'/'+repo.repo+'/archive/'+repo.branch+'.tar.gz')
  gzipStream.on('response', failedHttp)
}

console.log('Creating new project %s from %s', name, gzipSrc)

var formatter = function(stream) {
  var def = conf.defaults || {}
  def.name = name

  return stream.pipe(format(function(name) {
    return argv[name] || def[name] || '{{'+name+'}}'
  }))
}


gzipStream
  .pipe(gunzip())
  .pipe(tar.extract(name, {strip:1, mapStream:formatter}))
  .on('finish', function() {
    console.log('Project created in %s', path.resolve(dir))
  })