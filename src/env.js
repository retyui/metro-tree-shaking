/** Tree shaking is on by default for production bundles. Opt out with `TREE_SHAKING=0`. */
const isTreeShakingEnabled = () => process.env.TREE_SHAKING !== '0';

module.exports = { isTreeShakingEnabled };
