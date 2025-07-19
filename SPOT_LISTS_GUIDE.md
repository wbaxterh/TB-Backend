# Spot Lists API Guide for Chrome Extension

## Overview

This guide explains how to use the new spot lists API endpoints to manage skate spots and organize them into user-created lists.

## Authentication

All endpoints require a JWT token in the `x-auth-token` header:

```javascript
const headers = {
	"Content-Type": "application/json",
	"x-auth-token": "YOUR_JWT_TOKEN_HERE",
};
```

## API Endpoints

### 1. Spot Lists Management

#### Create a New Spot List

```javascript
async function createSpotList(name, description = "") {
	const response = await fetch("https://api.thetrickbook.com/api/spotlists", {
		method: "POST",
		headers,
		body: JSON.stringify({ name, description }),
	});

	if (!response.ok) {
		throw new Error(`Failed to create spot list: ${response.status}`);
	}

	return response.json();
}
```

#### Get User's Spot Lists

```javascript
async function getUserSpotLists() {
	const response = await fetch("https://api.thetrickbook.com/api/spotlists", {
		method: "GET",
		headers,
	});

	if (!response.ok) {
		throw new Error(`Failed to get spot lists: ${response.status}`);
	}

	return response.json();
}
```

#### Update a Spot List

```javascript
async function updateSpotList(listId, name, description = "") {
	const response = await fetch(
		`https://api.thetrickbook.com/api/spotlists/${listId}`,
		{
			method: "PUT",
			headers,
			body: JSON.stringify({ name, description }),
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to update spot list: ${response.status}`);
	}

	return response.json();
}
```

#### Delete a Spot List

```javascript
async function deleteSpotList(listId) {
	const response = await fetch(
		`https://api.thetrickbook.com/api/spotlists/${listId}`,
		{
			method: "DELETE",
			headers,
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to delete spot list: ${response.status}`);
	}

	return response.json();
}
```

### 2. Spot Management

#### Sync Spots (Bulk Insert)

```javascript
async function syncSpotsToTrickBook(spots) {
	const response = await fetch("https://api.thetrickbook.com/api/spots/bulk", {
		method: "POST",
		headers,
		body: JSON.stringify({ parks: spots }),
	});

	if (!response.ok) {
		throw new Error(`Failed to sync spots: ${response.status}`);
	}

	return response.json();
}
```

#### Get Spots in a List

```javascript
async function getSpotsInList(listId) {
	const response = await fetch(
		`https://api.thetrickbook.com/api/spotlists/${listId}/spots`,
		{
			method: "GET",
			headers,
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to get spots in list: ${response.status}`);
	}

	return response.json();
}
```

#### Get Lists Containing a Spot

```javascript
async function getListsForSpot(spotId) {
	const response = await fetch(
		`https://api.thetrickbook.com/api/spots/${spotId}/lists`,
		{
			method: "GET",
			headers,
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to get lists for spot: ${response.status}`);
	}

	return response.json();
}
```

### 3. Spot-List Relationships

#### Add Spot to List

```javascript
async function addSpotToList(listId, spotId) {
	const response = await fetch(
		`https://api.thetrickbook.com/api/spotlists/${listId}/spots`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ spotId }),
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to add spot to list: ${response.status}`);
	}

	return response.json();
}
```

#### Remove Spot from List

```javascript
async function removeSpotFromList(listId, spotId) {
	const response = await fetch(
		`https://api.thetrickbook.com/api/spotlists/${listId}/spots/${spotId}`,
		{
			method: "DELETE",
			headers,
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to remove spot from list: ${response.status}`);
	}

	return response.json();
}
```

## Data Structures

### Spot Object

```javascript
{
  "_id": "507f1f77bcf86cd799439011",
  "name": "Hamilton Bridge Skate Park",
  "latitude": 40.8034311,
  "longitude": -74.0706182,
  "imageURL": "https://example.com/image.jpg",
  "description": "Great skate park",
  "rating": 4,
  "tags": "street, bowl, rails, ledges",
  "city": "New York",
  "state": "NY"
}
```

### Spot List Object

```javascript
{
  "_id": "507f1f77bcf86cd799439012",
  "name": "My Favorite Parks",
  "description": "The best skate spots in NYC",
  "userId": "507f1f77bcf86cd799439013",
  "spotIds": ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439014"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## Workflow Examples

### 1. Create List and Add Spots

```javascript
async function createListAndAddSpots(spots) {
	try {
		// 1. Create a new spot list
		const newList = await createSpotList(
			"Scraped Spots",
			"Spots from map scraping"
		);

		// 2. Sync spots to database
		const syncedSpots = await syncSpotsToTrickBook(spots);

		// 3. Add each spot to the list
		for (const spot of syncedSpots) {
			await addSpotToList(newList._id, spot._id);
		}

		console.log(`Successfully created list with ${syncedSpots.length} spots`);
		return newList;
	} catch (error) {
		console.error("Error creating list and adding spots:", error);
		throw error;
	}
}
```

### 2. Check if Spot Exists and Add to List

```javascript
async function addSpotToExistingList(spot, listId) {
	try {
		// 1. Sync the spot (will return existing if lat/long matches)
		const syncedSpots = await syncSpotsToTrickBook([spot]);
		const syncedSpot = syncedSpots[0];

		// 2. Add to specified list
		await addSpotToList(listId, syncedSpot._id);

		console.log(`Added spot "${syncedSpot.name}" to list`);
		return syncedSpot;
	} catch (error) {
		console.error("Error adding spot to list:", error);
		throw error;
	}
}
```

## Error Handling

### Common Error Responses

- `400` - Invalid request data
- `401` - Authentication required
- `404` - Resource not found
- `500` - Server error

### Error Handling Example

```javascript
async function handleApiCall(apiFunction, ...args) {
	try {
		return await apiFunction(...args);
	} catch (error) {
		if (error.message.includes("401")) {
			// Handle authentication error
			console.error("Authentication failed. Please check your token.");
		} else if (error.message.includes("404")) {
			// Handle not found error
			console.error("Resource not found.");
		} else {
			// Handle other errors
			console.error("API call failed:", error.message);
		}
		throw error;
	}
}
```

## Best Practices

1. **Always handle errors** - Wrap API calls in try-catch blocks
2. **Check response status** - Verify responses are successful
3. **Use proper authentication** - Include JWT token in all requests
4. **Validate data** - Ensure spot data has required fields before sending
5. **Batch operations** - Use bulk endpoints when possible
6. **Cache responses** - Store user's spot lists locally to reduce API calls

## Integration with Map Scraper

### Modified syncToTrickBook Function

```javascript
async function syncToTrickBook(list, targetListId = null) {
	try {
		console.log("Syncing spots to TrickBook...");

		// Transform the list to match API schema
		const transformedList = list.map((spot) => ({
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
		const syncedSpots = await syncSpotsToTrickBook(transformedList);

		// If target list is specified, add spots to it
		if (targetListId) {
			for (const spot of syncedSpots) {
				await addSpotToList(targetListId, spot._id);
			}
			console.log(`Added ${syncedSpots.length} spots to list ${targetListId}`);
		}

		return syncedSpots;
	} catch (error) {
		console.error("Error syncing to TrickBook:", error);
		throw error;
	}
}
```
