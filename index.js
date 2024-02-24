const { request } = require("https");
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { username, password, token, channel, reaction, users, contests } = require("./configuration.json");

let session;
let csrfToken;
let userId;

let state;

const pronounsTranslations = {
	"he/him": "wbił",
	"she/her": "wbiła"
};

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
					const problems = JSON.parse(buffer);
					const result = {};

					for (const [ id, round, problem, canView, label, name ] of problems[3])
						result[id] = name;

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
					const ranking = JSON.parse(buffer);
					const result = {};

					for (let index = 1; index < ranking.length; index++) {
						const solved = [];

						for (const [ id, round, problem, status, score ] of ranking[index][2])
							if (score === 100)
								solved.push(problem);

						result[ranking[index][1]] = solved;
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

const fetchState = async () => {
	const result = [];

	for (const { name } of users)
		result[name] = [];

	for (const contestId of contests)
		result[contestId] = await fetchRanking(contestId);

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
				session = null;
				csrfToken = null;

				for (const cookie of response.headers["set-cookie"]) {
					const data = cookie.split("; ")[0];
					const index = data.indexOf("=");

					if (index === -1)
						continue;

					const name = data.substring(0, index);
					const value = data.substring(index + 1);

					if (name === "session")
						session = value;
					else if (name === "csrf_token")
						csrfToken = value;
				}

				if (!session || !csrfToken)
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
					userId = JSON.parse(buffer).session.user_id;

					if (typeof userId !== "number") {
						reject(new Error("Missing user id!"));
						return;
					}
				} catch (error) {
					reject(error);
					return;
				}

				resolve();
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

const react = (messageId) => {
	return new Promise((resolve, reject) => {
		const result = request(`https://discord.com/api/channels/${channel}/messages/${messageId}/reactions/${reaction}/@me`, {
			method: "PUT",
			headers: {
				"Authorization": `Bot ${token}`
			}
		}, (response) => {
			if (response.statusCode === 204) {
				resolve();
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
const notify = (user, pronouns, contest, problem) => {
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
					await react(JSON.parse(buffer).id);
				} catch (error) {
					console.error("Failed to add reaction!", error);
				}

				resolve();
			});

			response.on("error", reject);
		});

		result.on("error", reject);
		result.end(JSON.stringify({
			embeds: [
				{
					description: `**${user}** właśnie ${pronounsTranslations[pronouns]} zadanie **${problem}** z contestu **${contest}**`,
					color: 0xaef4ae
				}
			]
		}));
	});
};

const getChanges = async () => {
	try {
		const newState = await fetchState();

		for (const contestId of contests) {
			const { contestName, problems } = await fetchProblems(contestId);

			for (const { name, pronouns } of users) {
				if (!newState[contestId][name])
					continue;

				if (!state[contestId][name])
					state[contestId][name] = [];

				for (const problem of newState[contestId][name]) {
					if (!state[contestId][name].includes(problem)) {
						await notify(name, pronouns, contestName, problems[problem]);
						state[contestId][name].push(problem);
					}
				}
			}
		}

		writeFileSync("state.json", JSON.stringify(newState));
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
				resolve();
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
} ;

const initialize = async () => {
	try {
		await fetchToken();
		await testToken();

		if (!existsSync("state.json")) {

		} else {

		}
		state = JSON.parse(readFileSync("state.json"));
		getChanges();
	} catch (error) {
		console.error("Failed to initialize!", error);
		setTimeout(initialize, 60_000);
	}
};

initialize();
