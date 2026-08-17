const { loadEnv } = require("@medusajs/framework/utils")
loadEnv("test", process.cwd())

/** Integration tests boot a real Medusa app (needs Postgres, see README). */
module.exports = {
	testEnvironment: "node",
	testMatch: ["**/integration-tests/http/*.spec.ts"],
	moduleFileExtensions: ["ts", "js", "json"],
	modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
	transform: {
		"^.+\\.[jt]sx?$": [
			"ts-jest",
			{
				tsconfig: "tsconfig.test.json",
				isolatedModules: true,
			},
		],
	},
	setupFiles: ["./integration-tests/setup.js"],
	testTimeout: 180_000,
}
