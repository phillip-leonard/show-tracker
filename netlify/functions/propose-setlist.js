// netlify/functions/propose-setlist.js — see netlify/functions/lib/setlistOpsHandler.js
// for the request and answer, and lib/setlistOps.js for what it does
// (5.60.7, pre-native server moves Part 2).
const { setlistOpHandler } = require('./lib/setlistOpsHandler');

exports.handler = setlistOpHandler('propose-setlist');
