const _ = require('underscore');
const Schema = mongoose.Schema;

const Settings = new Schema({
	_id: String,
	data: Schema.Types.Mixed
});

exports.Settings = mongoose.model('settings', Settings);

const Session = new Schema({
	_id: String,
	io_driver: String,
	io_id: String,
	io_data: Schema.Types.Mixed,
	settings: { type: String, ref: 'settings' },
	translate_from: String,
	translate_to: String,
	alias: String,
	is_admin: Boolean,
	pipe: Schema.Types.Mixed
});

Session.methods.saveSettings = async function(data) {
	let s = await exports.Settings.findOne({ _id: this.settings });
	if (s == null) s = new exports.Settings({ _id: this.settings });
	s.data = _.extend({}, s.data, data);
	s.markModified('data');
	return s.save();
};

Session.methods.getIODriver = function() {
	return IOManager.getDriver(this.io_driver);
};

Session.methods.saveInPipe = function(data) {
	this.pipe = _.extend(this.pipe || {}, data);
	this.markModified('pipe');
	return this.save();
};

Session.methods.getPipe = function() {
	return this.pipe || {};
};

Session.methods.getTranslateFrom = function() {
	return this.translate_from || config.language;
};

Session.methods.getTranslateTo = function() {
	return this.translate_to || config.language;
};

exports.Session = mongoose.model('session', Session);

const SessionInput = new Schema({
	session: { type: String, ref: 'session' },
	text: String,
});
exports.SessionInput = mongoose.model('session_input', SessionInput);

const IOQueue = new Schema({
	session: { type: String, ref: 'session' },
	driver: String,
	params: Schema.Types.Mixed,
	io_id: String
});
exports.IOQueue = mongoose.model('io_queue', IOQueue);

const Alarm = new Schema({
	session: { type: String, ref: 'session' },
	when: Date,
	what: String
});
exports.Alarm = mongoose.model('alarms', Alarm);

const Story = new Schema({
	title: String,
	text: String,
	tags: String,
	url: String,
	date: Date,
	facebook: Schema.Types.Mixed,
});
exports.Story = mongoose.model('stories', Story);

const Vision = new Schema({
	url: String,
	labels: String,
	date: Date
});
exports.Vision = mongoose.model('vision', Vision);

const Scheduler = new Schema({
	session: { type: String, ref: 'session' },
	manager_uid: String,
	program: String,
	yearly: String, // set dayofyear, hour and minute
	monthly: String, // set dayofmonth, hour and minute
	weekly: String, // set dayofweek, hour and minute
	daily: String, // set hour and minute
	hourly: String, // set minute
	on_tick: Boolean
});
exports.Scheduler = mongoose.model('scheduler', Scheduler);

const Knowledge = new Schema({
	input: String,
	output: String,
	session: { type: String, ref: 'session' },
	score: Number
});
exports.Knowledge = mongoose.model('knowledge', Knowledge);

const Music = new Schema({
	name: String,
	artist: String,
	url: String
});
exports.Music = mongoose.model('musics', Music);
