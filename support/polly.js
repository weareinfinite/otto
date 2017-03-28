const TAG = 'Polly';

const aws = require('aws-sdk');
const fs = require('fs');
const md5 = require('md5');

const Play = require(__basedir + '/support/play');

// Create an Polly client
const Polly = new aws.Polly({
	signatureVersion: 'v4',
	region: 'eu-west-1'
});

const CACHE_FILE = __cachedir + '/polly.json';
let cache = null;
try { cache = require(CACHE_FILE); } 
catch (ex) { cache = {}; }

let locale_to_voice = {};

function setCache(text, voice, file) {
	cache[ md5(text + voice) ] = file;
	fs.writeFile(CACHE_FILE, JSON.stringify(cache), () => {});
}

function getCache(text, voice) {
	const file = cache[ md5(text + voice) ];
	if (file != null && fs.existsSync(file)) return file;
}

function getVoice(opt) {
	return new Promise((resolve, reject) => {
		if (locale_to_voice[opt.locale]) {
			resolve(locale_to_voice[opt.locale]);
		} else {
			Polly.describeVoices({
				LanguageCode: opt.locale
			}, (err, data) => {
				if (err) {
					console.error(TAG, `falling back to config locale (${config.locale}) due errors`);
					return getVoice(_.extend(config, { locale: config.locale }))
					.then(resolve)
					.catch(reject);
				}

				console.debug(TAG, data);
				locale_to_voice[opt.locale] = data.Voices.find((v) => { return v.Gender == opt.gender; });
				resolve(locale_to_voice[opt.locale]);
			});
		}
	});
}

exports.download = function(text, opt) {
	return new Promise((resolve, reject) => {
		text = text.trim();
		opt = opt || {};

		if (opt.language != null) {
			opt.locale = Util.getLocaleFromLanguageCode(opt.language);
		}

		opt = _.extend(config.polly, {
			locale: config.locale
		}, opt);

		let cached_file = getCache(text, opt.locale);
		if (cached_file) {
			console.debug(TAG, cached_file, '(cached)');
			resolve(cached_file);
			return;
		}
		
		getVoice(opt)
		.then((voice) => {
			Polly.synthesizeSpeech({
				VoiceId: voice.Id,
				Text: text,
				OutputFormat: 'mp3',
			}, (err, data) => {
				if (err) {
					console.error(TAG, err);
					return reject(err);
				}

				const cached_audio_file = __cachedir + '/polly_' + require('uuid').v4() + '.mp3';
				fs.writeFile(cached_audio_file, data.AudioStream, function(err) {
					if (err) {
						console.error(TAG, err);
						return reject(err);
					}

					console.debug(TAG, cached_audio_file);

					setCache(text, voice, cached_audio_file);
					resolve(cached_audio_file);
				});
			});
		})
		.catch(reject);

	});
};

exports.play = function(text, opt) {
	return new Promise((resolve, reject) => {
		exports.download(text, opt)
		.then((polly_file) => {
			Play.fileToSpeaker(polly_file, (err) => {
				if (err) return reject(err);
				resolve();
			});
		})
		.catch(reject);
	});
};

exports.playToFile = function(text, file, opt) {
	return new Promise((resolve, reject) => {
		exports.download(text, opt)
		.then((polly_file) => {
			Play.fileToFile(polly_file, file, (err) => {
				if (err) return reject(err);
				resolve();
			});
		})
		.catch(reject);
	});
};

exports.playToTmpFile = function(text, opt) {
	return new Promise((resolve, reject) => {
		exports.download(text, opt)
		.then((polly_file) => {
			Play.fileToTmpFile(polly_file, (err) => {
				if (err) return reject(err);
				resolve();
			});
		})
		.catch(reject);
	});
};