let listings = [
  {
    id: 1, 
    name: "Skate Tricks",
    completed: "0",
    tricks: [
        {
            id: 1,
            name: "Vairal Fip",
            checked: "To Do",
        },
        {
            id: 2,
            name: "Kickflip down the mega big stair set I am so scared to try",
            checked: "Complete",
        },
        {
            id: 3,
            name: "Treflip",
            checked: "To Do",
        },
        {
            id: 4,
            name: "Heatherflip",
            checked: "To Do",
        }
    ]
},
{
    id: 2, 
    name: "Kendama Tricks",
    completed: 0,
    tricks: [
        {
            id: 1,
            name: "Ken Flip",
            checked: "To Do",
        },
        {
            id: 2,
            name: "whirlwind off the wall",
            checked: "To Do",
        },
        {
            id: 3,
            name: "Lunar Treflip",
            checked: "To Do",
        },
        {
            id: 4,
            name: "Cold Pizza",
            checked: "Complete",
        }
    ]
},
{
  id: 3, 
  name: "Snowboard Tricks",
  completed: 0,
  tricks: [
      {
          id: 1,
          name: "Cab 270 FS Board",
          checked: "To Do",
      },
      {
          id: 2,
          name: "FS 720 a jump",
          checked: "To Do",
      },
      {
          id: 3,
          name: "Hardway fs 270",
          checked: "To Do",
      },
      {
          id: 4,
          name: "BS 540",
          checked: "To Do",
      }
  ]
},
{
  id: 4, 
  name: "Wakeboard Tricks",
  completed: 0,
  tricks: [
      {
          id: 1,
          name: "Pete Rose",
          checked: "To Do",
      },
      {
          id: 2,
          name: "Rail to rail to rail",
          checked: "Complete",
      },
      {
          id: 3,
          name: "Frontroll fs lip pretzel",
          checked: "To Do",
      },
      {
          id: 4,
          name: "Fs 270 fs nose swap bs nose pretz 270 out",
          checked: "To Do",
      }
  ]
}
];

const addListing = (listing) => {
  listing.id = listings.length + 1;
  listings.push(listing);
};

const addTrick = (trick) =>{
  console.log("add trick called", trick);

  listings = listings.map(item => {
    if (item.id === trick.ListId) {
        item.tricks.push(trick)
    }
    return item;
  });
}

const getListings = () => listings;

const getListing = (id) => listings.find((listing) => listing.id === id);

const filterListings = (predicate) => listings.filter(predicate);

module.exports = {
  addTrick,
  addListing,
  getListings,
  getListing,
  filterListings,
};
