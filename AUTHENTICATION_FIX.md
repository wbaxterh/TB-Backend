# Authentication Token Storage Fix

## Problem

The Chrome extension is successfully authenticating but the token is not being persisted, causing repeated login prompts.

## Root Cause

Based on the console logs and empty local storage, the token is being received but not properly stored in `chrome.storage.local`.

## Solution

### 1. Update Background Script (background.js)

```javascript
// Add this to your background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "storeAuthToken") {
		// Store the token in chrome.storage.local
		chrome.storage.local.set(
			{
				authToken: request.token,
				authTimestamp: Date.now(),
				userEmail: request.email,
			},
			() => {
				console.log("Background: Token stored successfully");
				sendResponse({ success: true });
			}
		);
		return true; // Keep message channel open
	}

	if (request.action === "getAuthToken") {
		// Retrieve the stored token
		chrome.storage.local.get(["authToken", "authTimestamp"], (result) => {
			console.log("Background: Retrieved token from storage");
			sendResponse({
				token: result.authToken,
				timestamp: result.authTimestamp,
			});
		});
		return true; // Keep message channel open
	}

	if (request.action === "clearAuthToken") {
		// Clear the stored token
		chrome.storage.local.remove(
			["authToken", "authTimestamp", "userEmail"],
			() => {
				console.log("Background: Token cleared from storage");
				sendResponse({ success: true });
			}
		);
		return true; // Keep message channel open
	}
});
```

### 2. Update Login Page (login.js)

```javascript
// After successful login, store the token
async function handleSuccessfulLogin(token, email) {
	try {
		// Store token via background script
		const response = await chrome.runtime.sendMessage({
			action: "storeAuthToken",
			token: token,
			email: email,
		});

		if (response.success) {
			console.log("Login: Token stored successfully");
			// Show success message or redirect
			showSuccessMessage("Login successful! Token stored.");
		} else {
			console.error("Login: Failed to store token");
		}
	} catch (error) {
		console.error("Login: Error storing token:", error);
	}
}

// Update your existing login success handler
// Replace or add to your existing login success code:
function onLoginSuccess(authResponse) {
	console.log("Login successful, token received");

	// Store the token
	handleSuccessfulLogin(authResponse.token, authResponse.email);

	// Your existing success handling code...
}
```

### 3. Update Popup Script (popup.js)

```javascript
// Replace the getStoredToken function
async function getStoredToken() {
	try {
		// Get token from background script
		const response = await chrome.runtime.sendMessage({
			action: "getAuthToken",
		});

		if (response && response.token) {
			console.log("Popup: Retrieved token from storage");
			return response.token;
		} else {
			console.log("Popup: No token found in storage");
			return null;
		}
	} catch (error) {
		console.error("Popup: Error retrieving token:", error);
		return null;
	}
}

// Add a function to clear token (for logout)
async function clearStoredToken() {
	try {
		await chrome.runtime.sendMessage({
			action: "clearAuthToken",
		});
		console.log("Popup: Token cleared from storage");
	} catch (error) {
		console.error("Popup: Error clearing token:", error);
	}
}
```

### 4. Add Debug Functions

```javascript
// Add this to your popup.js for debugging
async function debugTokenStorage() {
	console.log("=== Token Storage Debug ===");

	// Check chrome.storage.local directly
	const result = await chrome.storage.local.get([
		"authToken",
		"authTimestamp",
		"userEmail",
	]);
	console.log("Direct storage check:", result);

	// Check via background script
	const bgResponse = await chrome.runtime.sendMessage({
		action: "getAuthToken",
	});
	console.log("Background script response:", bgResponse);

	// Check if token is valid
	if (result.authToken) {
		try {
			const response = await fetch(
				"https://api.thetrickbook.com/api/spotlists",
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"x-auth-token": result.authToken,
					},
				}
			);
			console.log("Token validation response:", response.status);
		} catch (error) {
			console.error("Token validation error:", error);
		}
	}
}

// Add a debug button to your popup HTML
// <button id="debugTokenBtn" class="btn btn-secondary">Debug Token Storage</button>

// Add event listener
document
	.getElementById("debugTokenBtn")
	?.addEventListener("click", debugTokenStorage);
```

### 5. Alternative: Direct Storage (Simpler Approach)

If the background script approach is too complex, you can use direct storage in the popup:

```javascript
// Simplified token storage functions
async function storeTokenDirectly(token, email) {
	try {
		await chrome.storage.local.set({
			authToken: token,
			authTimestamp: Date.now(),
			userEmail: email,
		});
		console.log("Token stored directly");
		return true;
	} catch (error) {
		console.error("Error storing token:", error);
		return false;
	}
}

async function getTokenDirectly() {
	try {
		const result = await chrome.storage.local.get([
			"authToken",
			"authTimestamp",
		]);
		console.log(
			"Token retrieved directly:",
			result.authToken ? "Found" : "Not found"
		);
		return result.authToken || null;
	} catch (error) {
		console.error("Error retrieving token:", error);
		return null;
	}
}

// Update your login success handler to use this
function onLoginSuccess(authResponse) {
	console.log("Login successful, token received");

	// Store token directly
	storeTokenDirectly(authResponse.token, authResponse.email);

	// Your existing success handling...
}
```

### 6. Check Manifest Permissions

Make sure your `manifest.json` includes the storage permission:

```json
{
	"permissions": ["storage", "activeTab", "tabs"]
}
```

## Testing the Fix

1. **Clear existing data**: Go to Chrome DevTools → Application → Storage → Clear site data for your extension
2. **Reload the extension**: Go to `chrome://extensions/` and reload your extension
3. **Test login**: Try logging in again
4. **Check storage**: In DevTools, check if the token appears in Local Storage
5. **Test persistence**: Close and reopen the extension popup

## Debug Steps

If the issue persists:

1. **Add console logs** to track token flow
2. **Check manifest permissions** are correct
3. **Verify storage API** is working
4. **Test with a simple token** first
5. **Check for errors** in the background script console

The key is ensuring the token flows from login → storage → popup correctly!
