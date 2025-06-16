const express = require("express");
require("dotenv").config();
const categories = require("./routes/categories");
const listings = require("./routes/listings");
const listing = require("./routes/listing");
const users = require("./routes/users");
const user = require("./routes/user");
const auth = require("./routes/auth");
// const googleSSO = require("./routes/auth");
const image = require("./routes/image");
const my = require("./routes/my");
const blog = require("./routes/blog");
const blogImage = require("./routes/blogImage");
const messages = require("./routes/messages");
const contact = require("./routes/contact");
const expoPushTokens = require("./routes/expoPushTokens");
const helmet = require("helmet");
const compression = require("compression");
const config = require("config");
const cors = require("cors");
const path = require("path");
const trickipedia = require("./routes/trickipedia");

// Enable CORS for all routes
app.use(
	cors({
		origin: "*", // Allows all origins
		// For development, you might use '*' to allow all origins
	})
);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "10mb" }));
app.use(helmet());
app.use(compression());
app.use(bodyParser.json());

app.use("/api/categories", categories);
app.use("/api/listing", listing);
app.use("/api/listings", listings);
app.use("/api/user", user);
app.use("/api/users", users);
app.use("/api/auth", auth);
app.use("/api/blog", blog);
app.use("/api/my", my);
app.use("/api/expoPushTokens", expoPushTokens);
app.use("/api/messages", messages);
app.use("/api/image", image);
app.use("/api/blogImage", blogImage);
app.use("/api/contact", contact);
app.use("/api/trickipedia", trickipedia);

const port = process.env.PORT || config.get("port");
app.listen(port, function () {
	console.log(`Server started on port ${port}...`);
});
