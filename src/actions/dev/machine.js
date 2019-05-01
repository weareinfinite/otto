exports.id = 'dev.machine';

module.exports = async function main({ queryResult }, session) {
  const { parameters: p, fulfillmentText } = queryResult;
  return fulfillmentText.replace('$_platform', process.platform);
};
