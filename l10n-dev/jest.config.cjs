/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	moduleNameMapper: {
		'^pseudo-localization$': '<rootDir>/node_modules/pseudo-localization/dist/localize.js',
	},
};
