module.exports = {
	testEnvironment: "node",
	testMatch: ["**/__tests__/**/*.spec.ts"],
	moduleFileExtensions: ["ts", "js", "json"],
	moduleNameMapper: { "^#src/(.*)$": "<rootDir>/src/$1" },
	transform: {
		"^.+\\.ts$": [
			"ts-jest",
			{
				tsconfig: "tsconfig.test.json",
			},
		],
	},
}
