const jwt = require("jsonwebtoken");

function authAccountOrAdmin() {
	return (req, res, next) => {
		try {
			const token = req.header("Authorization").split(" ")[1];
			if (!token) return res.status(401).send({ error: "Access Denied" });

			jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
				if (err) return res.status(403).send({ error: "Invalid Token" });

				// Attach user details from token to the request
				req.user = user;

				// Check if the user is an admin or the owner of the account
				if (
					user.role === "admin" ||
					user.id === req.params.id || // User can access their own account
					user.email === req.body.email // In case email is used
				) {
					return next();
				} else {
					return res.status(403).send({ error: "Access Denied" });
				}
			});
		} catch (error) {
			return res.status(401).send({ error: "Authentication Failed" });
		}
	};
}

module.exports = authAccountOrAdmin;
