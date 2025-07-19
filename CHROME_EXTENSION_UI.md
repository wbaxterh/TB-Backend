# Chrome Extension UI for Spot Management

## Overview

This document provides the HTML, CSS, and JavaScript code for managing spot lists and spots within the Chrome extension.

## HTML Structure

### Main Popup HTML (popup.html)

```html
<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>Map Spot Scraper</title>
		<link rel="stylesheet" href="styles.css" />
	</head>
	<body>
		<div class="container">
			<header>
				<h1>Map Spot Scraper</h1>
				<div class="auth-status" id="authStatus">
					<span class="status-indicator" id="statusIndicator"></span>
					<span id="statusText">Checking authentication...</span>
				</div>
			</header>

			<main>
				<!-- Authentication Section -->
				<section id="authSection" class="section">
					<h2>Authentication</h2>
					<div class="form-group">
						<label for="authToken">JWT Token:</label>
						<input
							type="password"
							id="authToken"
							placeholder="Enter your JWT token"
						/>
						<button id="saveToken" class="btn btn-primary">Save Token</button>
					</div>
				</section>

				<!-- Spot Lists Management -->
				<section id="spotListsSection" class="section">
					<div class="section-header">
						<h2>Spot Lists</h2>
						<button id="createListBtn" class="btn btn-secondary">
							Create New List
						</button>
					</div>

					<div id="spotListsContainer" class="lists-container">
						<!-- Spot lists will be populated here -->
					</div>
				</section>

				<!-- Scraping Section -->
				<section id="scrapingSection" class="section">
					<h2>Scrape Spots</h2>
					<div class="form-group">
						<label for="targetList">Add to List:</label>
						<select id="targetList" class="form-control">
							<option value="">Select a list...</option>
						</select>
					</div>
					<div class="button-group">
						<button id="scrapeBtn" class="btn btn-primary">
							Scrape Current Page
						</button>
						<button id="syncBtn" class="btn btn-success">
							Sync to TrickBook
						</button>
					</div>
					<div id="scrapingStatus" class="status-message"></div>
				</section>

				<!-- Scraped Spots Preview -->
				<section id="spotsPreviewSection" class="section">
					<h2>Scraped Spots</h2>
					<div id="spotsContainer" class="spots-container">
						<!-- Scraped spots will be shown here -->
					</div>
				</section>
			</main>
		</div>

		<!-- Modals -->
		<div id="createListModal" class="modal">
			<div class="modal-content">
				<div class="modal-header">
					<h3>Create New Spot List</h3>
					<span class="close">&times;</span>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label for="listName">List Name:</label>
						<input type="text" id="listName" placeholder="Enter list name" />
					</div>
					<div class="form-group">
						<label for="listDescription">Description:</label>
						<textarea
							id="listDescription"
							placeholder="Enter description (optional)"
						></textarea>
					</div>
				</div>
				<div class="modal-footer">
					<button id="createListConfirm" class="btn btn-primary">
						Create List
					</button>
					<button id="createListCancel" class="btn btn-secondary">
						Cancel
					</button>
				</div>
			</div>
		</div>

		<div id="listDetailsModal" class="modal">
			<div class="modal-content">
				<div class="modal-header">
					<h3 id="listDetailsTitle">List Details</h3>
					<span class="close">&times;</span>
				</div>
				<div class="modal-body">
					<div id="listDetailsContent">
						<!-- List details and spots will be shown here -->
					</div>
				</div>
				<div class="modal-footer">
					<button id="editListBtn" class="btn btn-secondary">Edit List</button>
					<button id="deleteListBtn" class="btn btn-danger">Delete List</button>
					<button id="closeListDetails" class="btn btn-primary">Close</button>
				</div>
			</div>
		</div>

		<script src="popup.js"></script>
	</body>
</html>
```

## CSS Styles (styles.css)

```css
/* Reset and Base Styles */
* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.4;
	color: #333;
	background: #f5f5f5;
}

.container {
	width: 400px;
	min-height: 500px;
	background: white;
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

/* Header */
header {
	background: #2c3e50;
	color: white;
	padding: 15px;
	text-align: center;
}

header h1 {
	font-size: 18px;
	margin-bottom: 10px;
}

.auth-status {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	font-size: 12px;
}

.status-indicator {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #95a5a6;
}

.status-indicator.authenticated {
	background: #27ae60;
}

.status-indicator.error {
	background: #e74c3c;
}

/* Main Content */
main {
	padding: 15px;
}

.section {
	margin-bottom: 20px;
	padding: 15px;
	border: 1px solid #ddd;
	border-radius: 6px;
	background: #fafafa;
}

.section-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 15px;
}

.section h2 {
	font-size: 16px;
	color: #2c3e50;
	margin-bottom: 10px;
}

/* Forms */
.form-group {
	margin-bottom: 15px;
}

.form-group label {
	display: block;
	margin-bottom: 5px;
	font-weight: 500;
	color: #555;
}

.form-control {
	width: 100%;
	padding: 8px 12px;
	border: 1px solid #ddd;
	border-radius: 4px;
	font-size: 14px;
}

.form-control:focus {
	outline: none;
	border-color: #3498db;
	box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
}

textarea.form-control {
	resize: vertical;
	min-height: 60px;
}

/* Buttons */
.btn {
	padding: 8px 16px;
	border: none;
	border-radius: 4px;
	font-size: 14px;
	cursor: pointer;
	transition: all 0.2s;
}

.btn-primary {
	background: #3498db;
	color: white;
}

.btn-primary:hover {
	background: #2980b9;
}

.btn-secondary {
	background: #95a5a6;
	color: white;
}

.btn-secondary:hover {
	background: #7f8c8d;
}

.btn-success {
	background: #27ae60;
	color: white;
}

.btn-success:hover {
	background: #229954;
}

.btn-danger {
	background: #e74c3c;
	color: white;
}

.btn-danger:hover {
	background: #c0392b;
}

.button-group {
	display: flex;
	gap: 10px;
	margin-top: 15px;
}

/* Lists Container */
.lists-container {
	max-height: 200px;
	overflow-y: auto;
}

.spot-list-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 10px;
	margin-bottom: 8px;
	background: white;
	border: 1px solid #ddd;
	border-radius: 4px;
	cursor: pointer;
	transition: all 0.2s;
}

.spot-list-item:hover {
	border-color: #3498db;
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.list-info h4 {
	font-size: 14px;
	margin-bottom: 2px;
}

.list-info p {
	font-size: 12px;
	color: #666;
}

.list-stats {
	text-align: right;
	font-size: 12px;
	color: #666;
}

/* Spots Container */
.spots-container {
	max-height: 300px;
	overflow-y: auto;
}

.spot-item {
	display: flex;
	align-items: center;
	padding: 10px;
	margin-bottom: 8px;
	background: white;
	border: 1px solid #ddd;
	border-radius: 4px;
}

.spot-image {
	width: 50px;
	height: 50px;
	object-fit: cover;
	border-radius: 4px;
	margin-right: 10px;
}

.spot-info {
	flex: 1;
}

.spot-info h4 {
	font-size: 14px;
	margin-bottom: 2px;
}

.spot-info p {
	font-size: 12px;
	color: #666;
	margin-bottom: 2px;
}

.spot-actions {
	display: flex;
	gap: 5px;
}

.spot-actions button {
	padding: 4px 8px;
	font-size: 12px;
}

/* Status Messages */
.status-message {
	margin-top: 10px;
	padding: 8px 12px;
	border-radius: 4px;
	font-size: 12px;
}

.status-message.success {
	background: #d4edda;
	color: #155724;
	border: 1px solid #c3e6cb;
}

.status-message.error {
	background: #f8d7da;
	color: #721c24;
	border: 1px solid #f5c6cb;
}

.status-message.info {
	background: #d1ecf1;
	color: #0c5460;
	border: 1px solid #bee5eb;
}

/* Modals */
.modal {
	display: none;
	position: fixed;
	z-index: 1000;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	background-color: rgba(0, 0, 0, 0.5);
}

.modal-content {
	background-color: white;
	margin: 10% auto;
	padding: 0;
	border-radius: 6px;
	width: 90%;
	max-width: 500px;
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-header {
	padding: 15px 20px;
	border-bottom: 1px solid #ddd;
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.modal-header h3 {
	margin: 0;
	font-size: 16px;
}

.close {
	color: #aaa;
	font-size: 20px;
	font-weight: bold;
	cursor: pointer;
}

.close:hover {
	color: #000;
}

.modal-body {
	padding: 20px;
}

.modal-footer {
	padding: 15px 20px;
	border-top: 1px solid #ddd;
	display: flex;
	justify-content: flex-end;
	gap: 10px;
}

/* Loading States */
.loading {
	opacity: 0.6;
	pointer-events: none;
}

.spinner {
	display: inline-block;
	width: 16px;
	height: 16px;
	border: 2px solid #f3f3f3;
	border-top: 2px solid #3498db;
	border-radius: 50%;
	animation: spin 1s linear infinite;
}

@keyframes spin {
	0% {
		transform: rotate(0deg);
	}
	100% {
		transform: rotate(360deg);
	}
}

/* Responsive */
@media (max-width: 480px) {
	.container {
		width: 100%;
	}

	.button-group {
		flex-direction: column;
	}

	.modal-content {
		width: 95%;
		margin: 5% auto;
	}
}
```

## JavaScript (popup.js)

```javascript
// Global variables
let authToken = "";
let spotLists = [];
let scrapedSpots = [];
let currentListId = null;

// DOM elements
const elements = {
	authToken: document.getElementById("authToken"),
	saveToken: document.getElementById("saveToken"),
	authStatus: document.getElementById("authStatus"),
	statusIndicator: document.getElementById("statusIndicator"),
	statusText: document.getElementById("statusText"),
	spotListsContainer: document.getElementById("spotListsContainer"),
	targetList: document.getElementById("targetList"),
	scrapeBtn: document.getElementById("scrapeBtn"),
	syncBtn: document.getElementById("syncBtn"),
	scrapingStatus: document.getElementById("scrapingStatus"),
	spotsContainer: document.getElementById("spotsContainer"),
	createListBtn: document.getElementById("createListBtn"),
	createListModal: document.getElementById("createListModal"),
	listDetailsModal: document.getElementById("listDetailsModal"),
};

// API Headers
function getHeaders() {
	return {
		"Content-Type": "application/json",
		"x-auth-token": authToken,
	};
}

// Initialize the popup
document.addEventListener("DOMContentLoaded", async () => {
	await initializePopup();
	setupEventListeners();
});

async function initializePopup() {
	// Load saved token
	authToken = await getStoredToken();
	if (authToken) {
		elements.authToken.value = authToken;
		await checkAuthentication();
	}

	// Load spot lists if authenticated
	if (authToken) {
		await loadSpotLists();
	}

	// Load scraped spots from storage
	scrapedSpots = await getStoredSpots();
	renderScrapedSpots();
}

function setupEventListeners() {
	// Authentication
	elements.saveToken.addEventListener("click", saveToken);

	// Spot lists
	elements.createListBtn.addEventListener("click", showCreateListModal);

	// Scraping
	elements.scrapeBtn.addEventListener("click", scrapeCurrentPage);
	elements.syncBtn.addEventListener("click", syncSpotsToTrickBook);

	// Modals
	setupModalEventListeners();
}

// Authentication Functions
async function saveToken() {
	authToken = elements.authToken.value.trim();
	if (!authToken) {
		showStatus("Please enter a valid token", "error");
		return;
	}

	await chrome.storage.local.set({ authToken });
	await checkAuthentication();
}

async function checkAuthentication() {
	try {
		updateAuthStatus("Checking...", "checking");

		const response = await fetch("https://api.thetrickbook.com/api/spotlists", {
			method: "GET",
			headers: getHeaders(),
		});

		if (response.ok) {
			updateAuthStatus("Authenticated", "authenticated");
			await loadSpotLists();
		} else {
			updateAuthStatus("Authentication failed", "error");
		}
	} catch (error) {
		updateAuthStatus("Connection error", "error");
	}
}

function updateAuthStatus(text, status) {
	elements.statusText.textContent = text;
	elements.statusIndicator.className = `status-indicator ${status}`;
}

// Spot Lists Management
async function loadSpotLists() {
	try {
		const response = await fetch("https://api.thetrickbook.com/api/spotlists", {
			method: "GET",
			headers: getHeaders(),
		});

		if (response.ok) {
			spotLists = await response.json();
			renderSpotLists();
			updateTargetListDropdown();
		}
	} catch (error) {
		console.error("Error loading spot lists:", error);
	}
}

function renderSpotLists() {
	elements.spotListsContainer.innerHTML = "";

	if (spotLists.length === 0) {
		elements.spotListsContainer.innerHTML =
			"<p>No spot lists found. Create your first list!</p>";
		return;
	}

	spotLists.forEach((list) => {
		const listElement = createSpotListElement(list);
		elements.spotListsContainer.appendChild(listElement);
	});
}

function createSpotListElement(list) {
	const div = document.createElement("div");
	div.className = "spot-list-item";
	div.innerHTML = `
    <div class="list-info">
      <h4>${list.name}</h4>
      <p>${list.description || "No description"}</p>
    </div>
    <div class="list-stats">
      <div>${list.spotIds?.length || 0} spots</div>
      <div>${formatDate(list.updatedAt)}</div>
    </div>
  `;

	div.addEventListener("click", () => showListDetails(list));
	return div;
}

function updateTargetListDropdown() {
	elements.targetList.innerHTML = '<option value="">Select a list...</option>';

	spotLists.forEach((list) => {
		const option = document.createElement("option");
		option.value = list._id;
		option.textContent = list.name;
		elements.targetList.appendChild(option);
	});
}

// Scraping Functions
async function scrapeCurrentPage() {
	try {
		elements.scrapeBtn.disabled = true;
		elements.scrapeBtn.innerHTML = '<span class="spinner"></span> Scraping...';

		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		const result = await chrome.tabs.sendMessage(tab.id, {
			action: "scrapeSpots",
		});

		if (result.success) {
			scrapedSpots = result.spots;
			await storeSpots(scrapedSpots);
			renderScrapedSpots();
			showStatus(
				`Scraped ${scrapedSpots.length} spots successfully!`,
				"success"
			);
		} else {
			showStatus("Failed to scrape spots: " + result.error, "error");
		}
	} catch (error) {
		showStatus("Error scraping spots: " + error.message, "error");
	} finally {
		elements.scrapeBtn.disabled = false;
		elements.scrapeBtn.textContent = "Scrape Current Page";
	}
}

async function syncSpotsToTrickBook() {
	if (scrapedSpots.length === 0) {
		showStatus("No spots to sync. Scrape some spots first!", "error");
		return;
	}

	const targetListId = elements.targetList.value;
	if (!targetListId) {
		showStatus("Please select a target list", "error");
		return;
	}

	try {
		elements.syncBtn.disabled = true;
		elements.syncBtn.innerHTML = '<span class="spinner"></span> Syncing...';

		// Transform spots to match API schema
		const transformedSpots = scrapedSpots.map((spot) => ({
			name: spot.name,
			latitude: parseFloat(spot.lat),
			longitude: parseFloat(spot.lon),
			imageURL: spot.imageUrl || "",
			description: spot.tags?.join(", ") || "",
			rating: 0,
			tags: spot.tags?.join(", ") || "",
			city: spot.city || "",
			state: spot.state || "",
		}));

		// Sync spots to database
		const syncedSpots = await syncSpotsToTrickBookAPI(transformedSpots);

		// Add spots to selected list
		for (const spot of syncedSpots) {
			await addSpotToListAPI(targetListId, spot._id);
		}

		showStatus(
			`Successfully synced ${syncedSpots.length} spots to TrickBook!`,
			"success"
		);

		// Clear scraped spots
		scrapedSpots = [];
		await storeSpots([]);
		renderScrapedSpots();

		// Refresh spot lists
		await loadSpotLists();
	} catch (error) {
		showStatus("Error syncing spots: " + error.message, "error");
	} finally {
		elements.syncBtn.disabled = false;
		elements.syncBtn.textContent = "Sync to TrickBook";
	}
}

// API Functions
async function syncSpotsToTrickBookAPI(spots) {
	const response = await fetch("https://api.thetrickbook.com/api/spots/bulk", {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({ parks: spots }),
	});

	if (!response.ok) {
		throw new Error(`Failed to sync spots: ${response.status}`);
	}

	return response.json();
}

async function addSpotToListAPI(listId, spotId) {
	const response = await fetch(
		`https://api.thetrickbook.com/api/spotlists/${listId}/spots`,
		{
			method: "POST",
			headers: getHeaders(),
			body: JSON.stringify({ spotId }),
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to add spot to list: ${response.status}`);
	}

	return response.json();
}

async function createSpotListAPI(name, description) {
	const response = await fetch("https://api.thetrickbook.com/api/spotlists", {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({ name, description }),
	});

	if (!response.ok) {
		throw new Error(`Failed to create spot list: ${response.status}`);
	}

	return response.json();
}

// UI Functions
function renderScrapedSpots() {
	elements.spotsContainer.innerHTML = "";

	if (scrapedSpots.length === 0) {
		elements.spotsContainer.innerHTML =
			'<p>No spots scraped yet. Click "Scrape Current Page" to get started!</p>';
		return;
	}

	scrapedSpots.forEach((spot) => {
		const spotElement = createSpotElement(spot);
		elements.spotsContainer.appendChild(spotElement);
	});
}

function createSpotElement(spot) {
	const div = document.createElement("div");
	div.className = "spot-item";
	div.innerHTML = `
    <img src="${spot.imageUrl || "placeholder.jpg"}" alt="${
		spot.name
	}" class="spot-image" onerror="this.src='placeholder.jpg'">
    <div class="spot-info">
      <h4>${spot.name}</h4>
      <p>${spot.tags?.join(", ") || "No tags"}</p>
      <p>${spot.lat}, ${spot.lon}</p>
    </div>
  `;
	return div;
}

function showStatus(message, type) {
	elements.scrapingStatus.textContent = message;
	elements.scrapingStatus.className = `status-message ${type}`;

	setTimeout(() => {
		elements.scrapingStatus.textContent = "";
		elements.scrapingStatus.className = "status-message";
	}, 5000);
}

// Modal Functions
function setupModalEventListeners() {
	// Create list modal
	const createListModal = elements.createListModal;
	const closeCreateModal = createListModal.querySelector(".close");
	const createListConfirm = document.getElementById("createListConfirm");
	const createListCancel = document.getElementById("createListCancel");

	closeCreateModal.onclick = () => (createListModal.style.display = "none");
	createListCancel.onclick = () => (createListModal.style.display = "none");

	createListConfirm.onclick = async () => {
		const name = document.getElementById("listName").value.trim();
		const description = document.getElementById("listDescription").value.trim();

		if (!name) {
			alert("Please enter a list name");
			return;
		}

		try {
			await createSpotListAPI(name, description);
			createListModal.style.display = "none";
			await loadSpotLists();
			showStatus("Spot list created successfully!", "success");
		} catch (error) {
			showStatus("Error creating list: " + error.message, "error");
		}
	};

	// List details modal
	const listDetailsModal = elements.listDetailsModal;
	const closeListDetails = listDetailsModal.querySelector(".close");
	const closeListDetailsBtn = document.getElementById("closeListDetails");

	closeListDetails.onclick = () => (listDetailsModal.style.display = "none");
	closeListDetailsBtn.onclick = () => (listDetailsModal.style.display = "none");
}

function showCreateListModal() {
	document.getElementById("listName").value = "";
	document.getElementById("listDescription").value = "";
	elements.createListModal.style.display = "block";
}

async function showListDetails(list) {
	try {
		// Load spots in the list
		const response = await fetch(
			`https://api.thetrickbook.com/api/spotlists/${list._id}/spots`,
			{
				method: "GET",
				headers: getHeaders(),
			}
		);

		if (response.ok) {
			const spots = await response.json();
			renderListDetails(list, spots);
			elements.listDetailsModal.style.display = "block";
		}
	} catch (error) {
		showStatus("Error loading list details: " + error.message, "error");
	}
}

function renderListDetails(list, spots) {
	document.getElementById("listDetailsTitle").textContent = list.name;

	const content = document.getElementById("listDetailsContent");
	content.innerHTML = `
    <div class="list-info">
      <p><strong>Description:</strong> ${
				list.description || "No description"
			}</p>
      <p><strong>Created:</strong> ${formatDate(list.createdAt)}</p>
      <p><strong>Updated:</strong> ${formatDate(list.updatedAt)}</p>
      <p><strong>Spots:</strong> ${spots.length}</p>
    </div>
    <div class="spots-list">
      <h4>Spots in this list:</h4>
      ${spots
				.map(
					(spot) => `
        <div class="spot-item">
          <img src="${spot.imageURL || "placeholder.jpg"}" alt="${
						spot.name
					}" class="spot-image" onerror="this.src='placeholder.jpg'">
          <div class="spot-info">
            <h4>${spot.name}</h4>
            <p>${spot.city}, ${spot.state}</p>
            <p>${spot.tags || "No tags"}</p>
          </div>
        </div>
      `
				)
				.join("")}
    </div>
  `;
}

// Utility Functions
function formatDate(dateString) {
	if (!dateString) return "Unknown";
	return new Date(dateString).toLocaleDateString();
}

async function getStoredToken() {
	const result = await chrome.storage.local.get(["authToken"]);
	return result.authToken || "";
}

async function getStoredSpots() {
	const result = await chrome.storage.local.get(["scrapedSpots"]);
	return result.scrapedSpots || [];
}

async function storeSpots(spots) {
	await chrome.storage.local.set({ scrapedSpots: spots });
}

// Close modals when clicking outside
window.onclick = function (event) {
	if (event.target.classList.contains("modal")) {
		event.target.style.display = "none";
	}
};
```

## Content Script (content.js)

```javascript
// Content script for scraping spots from Google Maps
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "scrapeSpots") {
		scrapeSpots()
			.then((spots) => {
				sendResponse({ success: true, spots });
			})
			.catch((error) => {
				sendResponse({ success: false, error: error.message });
			});
		return true; // Keep message channel open for async response
	}
});

async function scrapeSpots() {
	// Wait for page to load
	await waitForElement('[data-value="Skateboarding"]');

	const spots = [];

	// Find all place cards
	const placeCards = document.querySelectorAll('[data-value="Skateboarding"]');

	for (const card of placeCards) {
		try {
			const spot = await extractSpotData(card);
			if (spot) {
				spots.push(spot);
			}
		} catch (error) {
			console.error("Error extracting spot data:", error);
		}
	}

	return spots;
}

async function extractSpotData(card) {
	// Extract name
	const nameElement = card.querySelector("h3, .fontHeadlineSmall");
	const name = nameElement?.textContent?.trim();

	if (!name) return null;

	// Extract coordinates from data attributes or URL
	const coordinates = extractCoordinates(card);
	if (!coordinates) return null;

	// Extract image URL
	const imageElement = card.querySelector("img");
	const imageUrl = imageElement?.src || "";

	// Extract tags/categories
	const tags = extractTags(card);

	// Extract location info
	const location = extractLocation(card);

	return {
		name,
		lat: coordinates.lat,
		lon: coordinates.lng,
		imageUrl,
		tags,
		city: location.city,
		state: location.state,
		createdAt: new Date().toISOString(),
	};
}

function extractCoordinates(card) {
	// Try to get coordinates from data attributes
	const dataLat = card.getAttribute("data-lat");
	const dataLng = card.getAttribute("data-lng");

	if (dataLat && dataLng) {
		return { lat: parseFloat(dataLat), lng: parseFloat(dataLng) };
	}

	// Try to extract from URL or other sources
	// This would need to be customized based on the specific page structure
	return null;
}

function extractTags(card) {
	const tags = [];

	// Look for category indicators
	const categoryElements = card.querySelectorAll(
		".category, .type, [data-category]"
	);
	categoryElements.forEach((el) => {
		const tag = el.textContent?.trim();
		if (tag) tags.push(tag);
	});

	return tags;
}

function extractLocation(card) {
	// Extract city and state from address elements
	const addressElement = card.querySelector(".address, [data-address]");
	const address = addressElement?.textContent || "";

	// Simple parsing - this could be improved
	const parts = address.split(",").map((part) => part.trim());
	const city = parts[parts.length - 2] || "";
	const state = parts[parts.length - 1] || "";

	return { city, state };
}

function waitForElement(selector, timeout = 5000) {
	return new Promise((resolve, reject) => {
		const element = document.querySelector(selector);
		if (element) {
			resolve(element);
			return;
		}

		const observer = new MutationObserver((mutations, obs) => {
			const element = document.querySelector(selector);
			if (element) {
				obs.disconnect();
				resolve(element);
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		setTimeout(() => {
			observer.disconnect();
			reject(new Error(`Element ${selector} not found within ${timeout}ms`));
		}, timeout);
	});
}
```

## Manifest (manifest.json)

```json
{
	"manifest_version": 3,
	"name": "Map Spot Scraper",
	"version": "1.0",
	"description": "Scrape skate spots from Google Maps and organize them into lists",
	"permissions": ["activeTab", "storage", "tabs"],
	"host_permissions": [
		"https://api.thetrickbook.com/*",
		"https://www.google.com/*",
		"https://maps.google.com/*"
	],
	"action": {
		"default_popup": "popup.html",
		"default_title": "Map Spot Scraper"
	},
	"content_scripts": [
		{
			"matches": ["https://www.google.com/maps/*", "https://maps.google.com/*"],
			"js": ["content.js"]
		}
	],
	"background": {
		"service_worker": "background.js"
	}
}
```

## Usage Instructions

1. **Install the extension** by loading it as an unpacked extension in Chrome
2. **Get your JWT token** from the TrickBook API
3. **Enter the token** in the extension popup
4. **Navigate to Google Maps** and search for skate spots
5. **Click "Scrape Current Page"** to extract spots
6. **Select a target list** or create a new one
7. **Click "Sync to TrickBook"** to save spots to your account

The extension provides a complete UI for managing spot lists and syncing scraped spots to your TrickBook account!
