const { request } = require("https");
const { readFileSync, writeFileSync, existsSync, stat } = require("fs");
const { username, password, token, channel, reaction, users, contests } = require("./configuration.json");

/** @type {string} */
let session;

/** @type {string} */
let csrfToken;

/** @type {number} */
let userId;

/** @type {Map<number, Map<string, Set<number>>>} */
let state;

const pronounsTranslations = {
	"he/him": "wbił",
	"she/her": "wbiła"
};

/** @type {Map<string, keyof pronounsTranslations>} */
let pronouns = new Map();

for (const user of users)
	pronouns.set(user.name, /** @type {keyof pronounsTranslations} */ (user.pronouns));

/**
 * @param {number} contestId
 * @returns {Promise<{
 * 	contestName: string;
 * 	problems: Map<number, string>;
 * }>}
 */
const fetchProblems = (contestId) => {
	return new Promise((resolve, reject) => {
		const result = request(`https://sim.13lo.pl/api/contest/c${contestId}`, {
			method: "POST",
			headers: {
				"Accept": "application/json",
				"Cookie": `session=${session}; csrf_token=${csrfToken}`,
				"Content-Type": "application/x-www-form-urlencoded"
			}
		}, (response) => {
			let buffer = Buffer.alloc(0);

			response.on("data", (data) => {
				buffer = Buffer.concat([ buffer, data ]);
			});

			response.on("end", () => {
				if (response.statusCode !== 200) {
					reject(new Error(`Status ${response.statusCode}: ${buffer.toString()}`));
					return;
				}

				try {
					const problems = JSON.parse(buffer.toString());

					/** @type {Map<number, string>} */
					const result = new Map();

					for (const [ id, _round, _problem, _canView, _label, name ] of problems[3])
						result.set(id, name);

					resolve({
						contestName: problems[1][1],
						problems: result
					});
				} catch (error) {
					reject(error);
				}
			});

			response.on("error", reject);

		});

		result.on("error", reject);
		result.end(`csrf_token=${csrfToken}`);
	});
};

/**
 * @param {number} contestId
 * @returns {Promise<Map<string, Set<number>>>}
 */
const fetchRanking = (contestId) => {
	return new Promise((resolve, reject) => {
		const result = request(`https://sim.13lo.pl/api/contest/c${contestId}/ranking`, {
			method: "POST",
			headers: {
				"Accept": "application/json",
				"Cookie": `session=${session}; csrf_token=${csrfToken}`,
				"Content-Type": "application/x-www-form-urlencoded"
			}
		}, (response) => {
			let buffer = Buffer.alloc(0);

			response.on("data", (data) => {
				buffer = Buffer.concat([ buffer, data ]);
			});

			response.on("end", () => {
				if (response.statusCode !== 200) {
					console.log(contestId);
					reject(new Error(`Status ${response.statusCode}: ${buffer.toString()}`));
					return;
				}

				try {
					const ranking = JSON.parse(buffer.toString());

					/** @type {Map<string, Set<number>>} */
					const result = new Map();

					for (let index = 1; index < ranking.length; index++) {
						/** @type {Set<number>} */
						const solved = new Set();

						for (const [ _id, _round, problem, _status, score ] of ranking[index][2]) {
							if (score !== 100)
								continue;

							solved.add(problem);
						}

						result.set(ranking[index][1], solved);
					}

					resolve(result);
				} catch (error) {
					reject(error);
				}
			});

			response.on("error", reject);

		});

		result.on("error", reject);
		result.end(`csrf_token=${csrfToken}`);
	});
};

/**
 * @returns {Promise<Map<number, Map<string, Set<number>>>>}
 */
const fetchState = async () => {
	/** @type {Map<number, Map<string, Set<number>>>} */
	const result = new Map();

	for (const contestId of contests)
		result.set(contestId, await fetchRanking(contestId));

	return result;
};

const fetchToken = () => {
	return new Promise((resolve, reject) => {
		const result = request("https://sim.13lo.pl/api/sign_in", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"x-csrf-token": ""
			}
		}, (response) => {
			if (response.statusCode === 200) {
				let hasSession = false;
				let hasCsrtToken = false;

				for (const cookie of response.headers["set-cookie"] || []) {
					const data = cookie.split("; ")[0];
					const index = data.indexOf("=");

					if (index === -1)
						continue;

					const name = data.substring(0, index);
					const value = data.substring(index + 1);

					if (name === "session") {
						session = value;
						hasSession = true;
					} else if (name === "csrf_token") {
						csrfToken = value;
						hasCsrtToken = true;
					}
				}

				if (!hasSession || !hasCsrtToken)
					reject(new Error("Missing cookies!"));

			}

			let buffer = Buffer.alloc(0);

			response.on("data", (data) => {
				buffer = Buffer.concat([ buffer, data ]);
			});

			response.on("end", () => {
				if (response.statusCode !== 200) {
					reject(new Error(buffer.toString()));
					return;
				}

				try {
					userId = JSON.parse(buffer.toString()).session.user_id;

					if (typeof userId !== "number") {
						reject(new Error("Missing user id!"));
						return;
					}
				} catch (error) {
					reject(error);
					return;
				}

				resolve(undefined);
			});

			response.on("error", reject);
		});

		result.on("error", reject);
		result.end([
			`username=${encodeURIComponent(username)}`,
			`password=${encodeURIComponent(password)}`,
			"remember_for_a_month=true"
		].join("&"));
	});
};

/**
 * @param {string} messageId
 */
const react = (messageId) => {
	return new Promise((resolve, reject) => {
		const result = request(`https://discord.com/api/channels/${channel}/messages/${messageId}/reactions/${reaction}/@me`, {
			method: "PUT",
			headers: {
				"Authorization": `Bot ${token}`
			}
		}, (response) => {
			if (response.statusCode === 204) {
				resolve(undefined);
				return;
			}

			let buffer = Buffer.alloc(0);

			response.on("data", (data) => {
				buffer = Buffer.concat([ buffer, data ]);
			});

			response.on("end", () => {
				reject(new Error(`Status ${response.statusCode}: ${buffer.toString()}`));
			});

			response.on("error", reject);
		});

		result.on("error", reject);
		result.end();
	});
};

/**
 * @param {string} user
 * @param {keyof pronounsTranslations} pronouns
 * @param {string} contest
 * @param {number} problemId
 * @param {string} problemName
 * @param {number} done
 * @param {number} total
 */
const notify = (user, pronouns, contest, problemId, problemName, done, total) => {
	return new Promise((resolve, reject) => {
		const result = request(`https://discord.com/api/channels/${channel}/messages`, {
			method: "POST",
			headers: {
				"Authorization": `Bot ${token}`,
				"Content-Type": "application/json"
			}
		}, (response) => {
			let buffer = Buffer.alloc(0);

			response.on("data", (data) => {
				buffer = Buffer.concat([ buffer, data ]);
			});

			response.on("end", async () => {
				if (response.statusCode !== 200) {
					reject(new Error(`Status ${response.statusCode}: ${buffer.toString()}`));
					return;
				}

				try {
					await react(JSON.parse(buffer.toString()).id);
				} catch (error) {
					console.error("Failed to add reaction!", error);
				}

				resolve(undefined);
			});

			response.on("error", reject);
		});

		result.on("error", reject);
		result.end(JSON.stringify({
			embeds: [
				{
					description: `**${user}** właśnie ${pronounsTranslations[pronouns]} zadanie [**${problemName}**](https://sim.13lo.pl/c/p${problemId}) z contestu **${contest}**`,
					footer: {
						text: `Contest progress: ${done}/${total} (${Math.floor(done / total * 100)}%)`
					},
					color: 0xaef4ae,
				}
			]
		}));
	});
};

/**
 * @typedef {{
 * 	contestId: number;
 * 	data: {
 * 		name: string;
 * 		problems: number[];
 * 	}[];
 * }[]} State
 */

const saveState = () => {
	/** @type {State} */
	const data = [];

	for (const [ contestId, contestData ] of state) {
		/**
		 * @type {{
		 * 	name: string;
		 * 	problems: number[];
		 * }[]}
		 */
		const rawContestData = [];

		for (const [ userName, userData ] of contestData) {
			rawContestData.push({
				name: userName,
				problems: [ ...userData ]
			})
		}

		data.push({
			contestId,
			data: rawContestData
		});
	}

	writeFileSync("state.json", JSON.stringify(data, null, "\t"));
};

const readState = () => {
	/** @type {State} */
	const data = JSON.parse(readFileSync("state.json").toString());

	for (const contest of data) {
		/** @type {Map<string, Set<number>>} */
		const contestEntry = new Map();

		for (const user of contest.data) {
			/** @type {Set<number>} */
			const problems = new Set();

			for (const problem of user.problems)
				problems.add(problem);

			contestEntry.set(user.name, problems);
		}

		state.set(contest.contestId, contestEntry);
	}
};

const getChanges = async () => {
	try {
		const newState = await fetchState();

		for (const [ contestId, contestData ] of newState) {
			const { contestName, problems } = await fetchProblems(contestId);

			let contestEntry = state.get(contestId);
			if (!contestEntry) {
				contestEntry = new Map();
				state.set(contestId, contestEntry);
			}

			for (const [ userName, userData ] of contestData) {
				let userEntry = contestEntry.get(userName);
				if (!userEntry) {
					userEntry = new Set();
					contestEntry.set(userName, userEntry);
				}

				for (const problemId of userData) {
					if (userEntry.has(problemId))
						continue;
					userEntry.add(problemId);
					const problemName = problems.get(problemId) || "";
					console.log(userName, problems.get(problemId));
					let userPronouns = pronouns.get(userName);

					if (userPronouns)
						await notify(userName, userPronouns, contestName, problemId, problemName, userEntry.size, problems.size);
				}
			}
		}

		saveState();
	} catch (error) {
		console.log("Failed to get changes!", error);
	}

	setTimeout(getChanges, 60_000);
};

const testToken = () => {
	return new Promise((resolve, reject) => {
		const result = request(`https://sim.13lo.pl/api/user/${userId}`, {
			headers: {
				"Cookie": `session=${session}; csrf_token=${csrfToken}`
			}
		}, (response) => {
			if (response.statusCode === 200) {
				resolve(undefined);
				return;
			}

			let buffer = Buffer.alloc(0);

			response.on("data", (data) => {
				buffer = Buffer.concat([ buffer, data ]);
			});

			response.on("end", () => {
				reject(new Error(`Status ${response.statusCode}: ${buffer.toString()}`));
			});

			response.on("error", reject);
		});

		result.on("error", reject);
		result.end();
	});
};

const initialize = async () => {
	try {
		await fetchToken();
		await testToken();

		if (existsSync("state.json")) {
			state = new Map();
			readState();
		} else {
			state = await fetchState();
			saveState();
		}

		getChanges();
	} catch (error) {
		console.error("Failed to initialize!", error);
		setTimeout(initialize, 60_000);
	}
};

initialize();
