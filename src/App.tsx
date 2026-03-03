import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { objectToBase64, useGlobal } from 'qapp-core';
import { useAtom } from 'jotai';
import {
  MapContainer,
  Marker,
  Popup,
  useMap,
  useMapEvent,
} from 'react-leaflet';
import L from 'leaflet';

// Add this import for the theme atom
import { EnumTheme, themeAtom } from './state/global/system';
import {
  QdnTileLayer,
  MapViewSync,
  SetPreviewView,
  tileToLatLng,
} from './components/QdnTileLayer';

interface IdentifierMapping {
  identifier: string;
  name: string;
}

// Define interfaces for our component props
interface SearchResultItemProps {
  result: {
    name: string;
    link?: string;
    [key: string]: any;
  };
  // Fixed: Updated onLinkClick to accept optional string
  onLinkClick: (link: string | undefined, resultName: string) => void;
}

interface SearchResultsListProps {
  searchResults: Array<{
    name: string;
    link?: string;
    [key: string]: any;
  }>;
  // Fixed: Updated onLinkClick to accept optional string
  onLinkClick: (link: string | undefined, resultName: string) => void;
}

interface SearchResult {
  identifier: string;
  name: string;
  category?: number;
  score?: number;
  link?: string;
  [key: string]: any;
}

interface NeighborhoodData {
  t: string; // term (user name + neighborhood)
  n: string; // name from the upper left tile
  c: number; // category number (901 for neighborhoods)
  l: string; // location coordinates separated by dash marks
  timestamp?: string | null; // timestamp when neighborhood was last updated
}

/** Parse freedom cell location string "zoom-lat-lng" (lng may be negative) to { lat, lng } or null */
function parseCellLocation(
  location: string
): { lat: number; lng: number } | null {
  if (!location || typeof location !== 'string') return null;
  const parts = location.split('-');
  if (parts.length < 3) return null;
  const lat = parseFloat(parts[1]);
  const lng = parseFloat(parts.slice(2).join('-'));
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

/** Reports current map bounds to parent when map moves (for filtering table and markers) */
function MapBoundsReporter({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: L.LatLngBounds) => void;
}) {
  const map = useMap();
  useEffect(() => {
    onBoundsChange(map.getBounds());
  }, [map, onBoundsChange]);
  useMapEvent('moveend', () => {
    onBoundsChange(map.getBounds());
  });
  return null;
}

/** Renders markers for freedom cells that have valid lat/lng. Larger hit area and dot scales with zoom for easier clicking. */
function FreedomCellMarkersLayer({
  cells,
  zoom,
}: {
  cells: Array<{
    name: string;
    location: string;
    description?: string;
    creator?: string;
  }>;
  zoom: number;
}) {
  const hitSize = 44;
  const anchor = hitSize / 2;
  const dotSize = Math.min(24, Math.max(12, 12 + (zoom - 1) * 0.9));
  const icon = L.divIcon({
    className: 'freedom-cell-marker',
    html: `<div style="width:${hitSize}px;height:${hitSize}px;display:flex;align-items:center;justify-content:center;cursor:pointer;"><div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:#28a745;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);pointer-events:none;"></div></div>`,
    iconSize: [hitSize, hitSize],
    iconAnchor: [anchor, anchor],
  });
  return (
    <>
      {cells.map((cell, index) => {
        const pos = parseCellLocation(cell.location);
        if (!pos) return null;
        return (
          <Marker
            key={`${cell.creator ?? ''}-${cell.name}-${index}`}
            position={[pos.lat, pos.lng]}
            icon={icon}
          >
            <Popup>
              <strong>{cell.name}</strong>
              {cell.creator && (
                <>
                  <br />
                  {cell.creator}
                </>
              )}
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// SearchResultItem component
const SearchResultItem = ({ result, onLinkClick }: SearchResultItemProps) => {
  return (
    <div
      style={{
        marginBottom: '3px',
        paddingBottom: '3px',
        borderBottom: '1px solid #eee',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div style={{ flex: 1 }}>{result.name}</div>
      <div style={{ flex: 1, textAlign: 'right' }}>
        {result.link ? (
          <button
            // Fixed: Explicitly pass result.link which is now guaranteed to be a string
            onClick={() => onLinkClick(result.link, result.name)}
            style={{
              padding: '2px 6px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '11px',
              textDecoration: 'none',
              display: 'inline-block',
            }}
            title={`Go to location: ${result.link}`}
          >
            {result.link}
          </button>
        ) : (
          <span
            style={{ color: '#999', fontStyle: 'italic', fontSize: '11px' }}
          >
            No link
          </span>
        )}
      </div>
    </div>
  );
};

// SearchResultsList component
const SearchResultsList = ({
  searchResults,
  onLinkClick,
}: SearchResultsListProps) => {
  if (searchResults.length === 0) return null;

  return (
    <div
      style={{
        marginTop: '10px',
        padding: '10px',
        backgroundColor: 'white',
        color: '#333',
        border: '1px solid #ddd',
        borderRadius: '4px',
        fontSize: '14px',
      }}
    >
      <div
        style={{
          maxHeight: '150px',
          overflowY: 'auto',
          padding: '5px',
        }}
      >
        {searchResults.map((result, index) => (
          <SearchResultItem
            key={index}
            result={result}
            onLinkClick={onLinkClick}
          />
        ))}
      </div>
    </div>
  );
};

function App() {
  // Move the useGlobal hook inside the component
  const { identifierOperations, auth } = useGlobal();
  const buildIdentifier = identifierOperations.buildIdentifier;

  // Add theme atom
  const [theme] = useAtom(themeAtom);

  // Add these state variables after the existing state declarations
  const [showAddressNamesModal, setShowAddressNamesModal] = useState(false);
  const [addressNames, setAddressNames] = useState<string[]>([]);
  const [addressNamesLoading, setAddressNamesLoading] = useState(false);
  const [addressNamesError, setAddressNamesError] = useState('');

  const [followedNames, setFollowedNames] = useState<string[]>([]);

  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const mapRef = useRef<L.Map | null>(null);
  const [identifiers, setIdentifiers] = useState<IdentifierMapping[]>([]);
  const [loading, setLoading] = useState(true);

  // States for the Search form
  const [searchQueryTerm, setSearchQueryTerm] = useState('');
  const [searchQueryError, setSearchQueryError] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // States for the Index form
  const [indexTerm, setIndexTerm] = useState('');
  const [indexError, setIndexError] = useState('');
  const [indexIdentifier, setIndexIdentifier] = useState<string>('');
  const [isGeneratingIdentifier, setIsGeneratingIdentifier] = useState(false);
  const [builtObject, setBuiltObject] = useState<any>(null);

  // New state for neighborhood images
  // States for the Set Neighborhood wizard
  const [hoodIndexError, setHoodIndexError] = useState('');
  const [isGeneratingHoodIdentifier, setIsGeneratingHoodIdentifier] =
    useState(false);
  const [hoodBuiltObject, setHoodBuiltObject] = useState<any>(null);

  // New state for the Set Neighborhood popup modal
  const [showSetNeighborhoodModal, setShowSetNeighborhoodModal] =
    useState(false);

  // States for the Start Freedom Cell wizard
  const [freedomCellName, setFreedomCellName] = useState('');
  const [isStartingFreedomCell, setIsStartingFreedomCell] = useState(false);

  const [hasExistingFreedomCell, setHasExistingFreedomCell] = useState(false);

  // New state for the Freedom Cell popup modal
  const [showFreedomCellModal, setShowFreedomCellModal] = useState(false);

  // New state for the confirmation modal
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [pendingFreedomCellName, setPendingFreedomCellName] = useState('');
  const [pendingFreedomCellIdentifier, setPendingFreedomCellIdentifier] =
    useState('');
  const [pendingFreedomCellObject, setPendingFreedomCellObject] =
    useState<any>(null);

  // New state for the user's neighborhood data
  const [userNeighborhood, setUserNeighborhood] =
    useState<NeighborhoodData | null>(null);
  const [neighborhoodLoading, setNeighborhoodLoading] = useState(false);
  const [neighborhoodError, setNeighborhoodError] = useState('');

  // New state to track if navigation is in progress
  // New state for controlling the search panel visibility
  const [showSearchPanel, setShowSearchPanel] = useState(false);

  // New state for controlling the index panel visibility
  const [showIndexPanel, setShowIndexPanel] = useState(false);

  // New state for group creation
  const [groupDescription, setGroupDescription] = useState('');

  // New state for the confirmation modal
  const [pendingGroupName, setPendingGroupName] = useState('');
  const [pendingGroupDescription, setPendingGroupDescription] = useState('');

  enum GroupType {
    CLOSED = 0,
    OPEN = 1,
    // possibly other values
  }

  // Add these new state declarations to your App component:
  const [freedomCellType, setFreedomCellType] = useState<GroupType>(
    GroupType.OPEN
  );
  const [freedomCellError, setFreedomCellError] = useState('');
  const [freedomCellSuccess, setFreedomCellSuccess] = useState('');

  const [freedomCellsData, setFreedomCellsData] = useState<any[]>([]);
  const [freedomCellsLoading, setFreedomCellsLoading] = useState(false);
  const [freedomCellsError, setFreedomCellsError] = useState('');
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);

  const [isCheckingForGroupTransaction, setIsCheckingForGroupTransaction] =
    useState(false);

  const [showErrorPanel, setShowErrorPanel] = useState(false);
  const [showSuccessPanel, setShowSuccessPanel] = useState(false);

  // Add these state variables at the top of your component
  const [modalState, setModalState] = useState({
    isOpen: false,
    type: 'error', // 'error' or 'success'
    message: '',
  });

  // Add these functions to handle the modal
  const showErrorModal = (message: string) => {
    setModalState({
      isOpen: true,
      type: 'error',
      message,
    });
  };

  const showSuccessModal = (message: string) => {
    setModalState({
      isOpen: true,
      type: 'success',
      message,
    });
  };

  const closeModal = () => {
    setModalState({
      ...modalState,
      isOpen: false,
    });
  };

  // Replace the existing function with this updated version
  const fetchCartographerAddressAndNames = async () => {
    // Only set loading if not already loaded to prevent flickering if called multiple times
    if (addressNames.length === 0) {
      setAddressNamesLoading(true);
    }
    setAddressNamesError('');

    try {
      // First, get the Cartographer name data to retrieve the address
      const nameDataResponse = await qortalRequest({
        action: 'GET_NAME_DATA',
        name: 'Cartographer',
      });

      if (!nameDataResponse || !nameDataResponse.owner) {
        throw new Error('Invalid name data response');
      }

      const address = nameDataResponse.owner;

      // Get the account names for this address
      const accountNamesResponse = await qortalRequest({
        action: 'GET_ACCOUNT_NAMES',
        address: address,
        limit: 0,
        offset: 0,
        reverse: false,
      });

      if (!Array.isArray(accountNamesResponse)) {
        throw new Error('Invalid account names response');
      }

      // Extract the names from the response
      const names = accountNamesResponse.map((item: any) => item.name);

      // Only update state if the names have actually changed to prevent unnecessary re-renders
      setAddressNames((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(names)) return prev;
        return names;
      });
    } catch (error) {
      console.error('Error fetching Cartographer address and names:', error);
      setAddressNamesError(
        `Failed to fetch address names: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setAddressNamesLoading(false);
    }
  };

  // Add this function after the existing functions
  const handleSelectAll = async (isChecked: boolean) => {
    // Keep local copy of addressNames to avoid issues if it changes during async ops
    const currentAddressNames = [...addressNames];
    if (currentAddressNames.length === 0) return;

    try {
      if (isChecked) {
        // Only add names that are NOT already in followedNames
        const namesToAdd = currentAddressNames.filter(
          (name) => !followedNames.includes(name)
        );
        if (namesToAdd.length === 0) return;

        await qortalRequest({
          action: 'ADD_LIST_ITEMS',
          list_name: 'followedNames',
          items: namesToAdd,
        });
        // Update state with all unique names
        setFollowedNames((prev) =>
          Array.from(new Set([...prev, ...namesToAdd]))
        );
      } else {
        // Only remove names that ARE in followedNames
        const namesToRemove = currentAddressNames.filter((name) =>
          followedNames.includes(name)
        );
        if (namesToRemove.length === 0) return;

        await qortalRequest({
          action: 'DELETE_LIST_ITEM',
          list_name: 'followedNames',
          items: namesToRemove,
        });
        setFollowedNames((prev) =>
          prev.filter((n) => !namesToRemove.includes(n))
        );
      }
    } catch (error) {
      console.error('Error updating followed names list:', error);
    }
  };

  const handleCheckboxChange = async (name: string, isChecked: boolean) => {
    try {
      if (isChecked) {
        // Add the name to the followed names list
        await qortalRequest({
          action: 'ADD_LIST_ITEMS',
          list_name: 'followedNames',
          items: [name],
        });
        setFollowedNames([...followedNames, name]);
      } else {
        // Remove the name from the followed names list
        await qortalRequest({
          action: 'DELETE_LIST_ITEM',
          list_name: 'followedNames',
          items: [name],
        });
        setFollowedNames(followedNames.filter((n) => n !== name));
      }
    } catch (error) {
      console.error('Error updating followed names list:', error);
      // You might want to show an error message to the user here
    }
  };

  // Function to discover if user has a neighborhood
  const discoverUserNeighborhood = async () => {
    const userName = auth?.name;

    if (!userName) {
      console.log('No user name available for neighborhood discovery');
      setNeighborhoodError('User name not available');
      return;
    }

    console.log('Discovering neighborhood for user:', userName);
    setNeighborhoodLoading(true);
    setNeighborhoodError('');

    try {
      // First, discover if the user has a neighborhood
      const searchResponse = await fetch(
        `/arbitrary/resources/searchsimple?service=JSON&identifier=idx-hood&name=${userName}&limit=1`
      );

      if (!searchResponse.ok) {
        throw new Error(
          `Network response was not ok: ${searchResponse.status}`
        );
      }

      const searchData = await searchResponse.json();
      console.log('Neighborhood search data:', searchData);

      if (Array.isArray(searchData) && searchData.length > 0) {
        // Neighborhood exists, get the timestamp
        const resource = searchData[0];
        const timestamp = resource.updated || resource.created || null;

        console.log('Neighborhood exists, timestamp:', timestamp);

        // Now fetch the actual neighborhood data
        const dataResponse = await fetch(
          `/arbitrary/JSON/${userName}/idx-hood`
        );

        if (!dataResponse.ok) {
          throw new Error(
            `Network response was not ok: ${dataResponse.status}`
          );
        }

        const data = await dataResponse.json();
        console.log('Raw neighborhood data from API:', data);

        // The API returns an array, take the first item
        if (Array.isArray(data) && data.length > 0) {
          const rawData = data[0];
          console.log('Raw neighborhood data from API:', rawData);

          // Map the API response to your expected format
          const neighborhoodData: NeighborhoodData = {
            t: rawData.t,
            n: rawData.n,
            c: rawData.c,
            l: rawData.l,
            timestamp: timestamp, // Add timestamp to the neighborhood data
          };

          console.log('Mapped neighborhood data:', neighborhoodData);
          setUserNeighborhood(neighborhoodData);
        } else {
          console.log('No neighborhood data in response');
          setUserNeighborhood(null);
        }
      } else {
        // No neighborhood found
        console.log('No neighborhood found for user:', userName);
        setUserNeighborhood(null);
      }
    } catch (error) {
      console.error('Error discovering user neighborhood:', error);
      setNeighborhoodError('Failed to discover neighborhood data');
      setUserNeighborhood(null);
    } finally {
      console.log('Neighborhood discovery completed');
      setNeighborhoodLoading(false);
    }
  };

  // Function to fetch and process Freedom Cell data


  const fetchFreedomCellsData = async () => {
    setFreedomCellsLoading(true);
    setFreedomCellsError('');

    try {
      // First call to get all idx-cell resources
      const resourcesResponse = await fetch(
        '/arbitrary/resources/searchsimple?service=JSON&identifier=idx-cell&limit=0'
      );

      if (!resourcesResponse.ok) {
        throw new Error(
          `Failed to fetch resources: ${resourcesResponse.status}`
        );
      }

      const resourcesData = await resourcesResponse.json();
      console.log('Resources data:', resourcesData);

      const freedomCellsPromises = resourcesData.map(async (resource: any) => {
        try {
          // Get idx-cell data
          const cellResponse = await fetch(
            `/arbitrary/${resource.service}/${resource.name}/idx-cell`
          );

          // Get idx-hood data
          const hoodResponse = await fetch(
            `/arbitrary/${resource.service}/${resource.name}/idx-hood`
          );

          // If either response is empty, discard this resource
          if (!cellResponse.ok || !hoodResponse.ok) {
            console.log(
              `Skipping ${resource.name}: idx-cell or idx-hood data not available`
            );
            return null;
          }

          const cellData = await cellResponse.json();
          const hoodData = await hoodResponse.json();
          console.log('Cell data:', cellData);
          console.log('Hood data:', hoodData);

          if (
            !Array.isArray(cellData) ||
            cellData.length === 0 ||
            !Array.isArray(hoodData) ||
            hoodData.length === 0
          ) {
            console.log(
              `Skipping ${resource.name}: idx-cell or idx-hood array is empty`
            );
            return null;
          }

          const cellInfo = cellData[0];
          const hoodInfo = hoodData[0];

          // Get name data
          const nameResponse = await fetch(`/names/${resource.name}`);

          if (!nameResponse.ok) {
            console.log(`Skipping ${resource.name}: name data not available`);
            return null;
          }

          const nameData = await nameResponse.json();
          console.log('nameData', nameData);
          // Get groups data
          const groupsResponse = await fetch(`/groups/owner/${nameData.owner}`);

          if (!groupsResponse.ok) {
            console.log(`Skipping ${resource.name}: groups data not available`);
            return null;
          }

          const groupsData = await groupsResponse.json();

          // Find the group that matches the cell's link (groupId)
          const matchingGroup = groupsData.find(
            (group: any) => group.groupId.toString() === cellInfo?.l?.toString()
          );

          if (!matchingGroup) {
            console.log(
              `Skipping ${resource.name}: no matching group found for groupId ${cellInfo.l}`
            );
            return null;
          }

          // Format the location from the hood data
          const location = hoodInfo.l;

          // Return the formatted data
          return {
            name: cellInfo.n,
            location: location,
            description: matchingGroup.description || '',
            creator: resource.name,
            timeCreated: new Date(
              resource.updated || resource.created
            ).toLocaleString(), // Use updated if available
            groupId: matchingGroup.groupId,
          };
        } catch (error) {
          console.error(`Error processing ${resource.name}:`, error);
          return null;
        }
      });

      const results = await Promise.all(freedomCellsPromises);
      // Filter out null results
      const validFreedomCells = results.filter((cell) => cell !== null);

      console.log('Valid Freedom Cells:', validFreedomCells);
      setFreedomCellsData(validFreedomCells);
    } catch (error) {
      console.error('Error fetching Freedom Cells data:', error);
      setFreedomCellsError(
        `Failed to fetch Freedom Cells data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setFreedomCellsLoading(false);
    }
  };
  // Discover user neighborhood on component mount and when auth name changes
  useEffect(() => {
    console.log(
      'useEffect triggered for neighborhood discovery, auth name:',
      auth?.name
    );
    if (auth?.name) {
      discoverUserNeighborhood();
    }
  }, [auth?.name]);

  // Check for existing Freedom Cell on component mount and when auth name changes
  useEffect(() => {
    const checkForExistingFreedomCell = async () => {
      try {
        if (!auth?.name) {
          setHasExistingFreedomCell(false);
          return;
        }

        const freedomCellResponse = await fetch(
          `/arbitrary/JSON/${auth.name}/idx-cell`
        );

        if (freedomCellResponse.ok) {
          const freedomCellData = await freedomCellResponse.json();
          if (Array.isArray(freedomCellData) && freedomCellData.length > 0) {
            setHasExistingFreedomCell(true);
          } else {
            setHasExistingFreedomCell(false);
          }
        } else {
          setHasExistingFreedomCell(false);
        }
      } catch (error) {
        setHasExistingFreedomCell(false);
      }
    };

    if (auth?.name) {
      checkForExistingFreedomCell();
    }
  }, [auth?.name]);

  // Fetch Freedom Cells data on component mount
  useEffect(() => {
    fetchFreedomCellsData();
  }, []);

  // Function to navigate to the user's neighborhood
  const navigateToNeighborhood = () => {
    if (userNeighborhood && userNeighborhood.l) {
      const parts = userNeighborhood.l.split('-');
      const savedZoom = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const lng = parseFloat(parts[2]);
      console.log('details', savedZoom, lat, lng);
      if (!isNaN(savedZoom) && !isNaN(lat) && !isNaN(lng)) {
        mapRef.current?.setView([lat, lng], savedZoom, { animate: false });
      } else {
        alert('Invalid coordinates in neighborhood data');
      }
    } else {
      alert('No neighborhood data available for navigation');
    }
  };

  // Handle search query form submission
  const handleSearchQuerySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQueryError('');
    setSearchResults([]);
    setIsSearching(true);

    const queryTerm = searchQueryTerm.trim();

    if (!queryTerm) {
      setSearchQueryError('Please enter a search term');
      setIsSearching(false);
      return;
    }

    try {
      console.log('Searching for term:', queryTerm);

      // Fetch data from the indices endpoint
      const response = await fetch(
        `/arbitrary/indices?terms=${encodeURIComponent(queryTerm)}`
      );

      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.status}`);
      }

      const data = await response.json();
      console.log('Raw search results:', data);

      // Filter results by category = 9
      const filteredResults = Array.isArray(data)
        ? data.filter((result) => result.category === 9)
        : [];

      console.log('Filtered results (category = 9):', filteredResults);

      // Sort filtered results by score in descending order
      const sortedResults = filteredResults.sort((a, b) => {
        // Handle cases where score might be undefined or null
        const scoreA = a.score || 0;
        const scoreB = b.score || 0;
        return scoreB - scoreA; // Descending order (highest first)
      });

      console.log('Sorted results (by score desc):', sortedResults);

      // Set the filtered and sorted search results
      setSearchResults(sortedResults);
    } catch (error) {
      console.error('Error searching indices:', error);
      setSearchQueryError(
        `Failed to search: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }

    // Clear the search term input
    setSearchQueryTerm('');
  };

  const handleButtonMouseOver = (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    button.style.backgroundColor =
      theme === EnumTheme.DARK ? '#218838' : '#218838';
  };

  const handleButtonMouseOut = (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    button.style.backgroundColor =
      theme === EnumTheme.DARK ? '#28a745' : '#28a745';
  };

  // Fixed: Updated handleLinkClick to handle potentially undefined link
  const handleLinkClick = (link: string | undefined, resultName: string) => {
    // Early return if link is undefined
    if (!link) {
      console.log('No link provided for result:', resultName);
      return;
    }

    try {
      console.log('Clicked link:', link, 'from result:', resultName);

      // Parse the link using dash mark as delimiter
      const parts = link.split('-');

      if (parts.length !== 3) {
        console.error('Invalid link format. Expected: zoom-x-y, got:', link);
        alert('Invalid link format. Expected format: zoom-x-y');
        return;
      }

      const newZoom = parseInt(parts[0]);
      const newX = parseInt(parts[1]);
      const newY = parseInt(parts[2]);

      // Validate the parsed values
      if (isNaN(newZoom) || isNaN(newX) || isNaN(newY)) {
        console.error('Invalid coordinates in link:', link);
        alert('Invalid coordinates in link');
        return;
      }

      if (newZoom < 1 || newZoom > 20) {
        console.error('Invalid zoom level in link:', newZoom);
        alert(`Invalid zoom level: ${newZoom}. Must be between 1 and 20`);
        return;
      }

      if (newX < 0 || newY < 0) {
        console.error('Invalid coordinates in link:', newX, newY);
        alert(`Invalid coordinates: X and Y must be non-negative`);
        return;
      }

      if (newX >= 2 ** newZoom || newY >= 2 ** newZoom) {
        console.error('Coordinates out of bounds for zoom level:', {
          newX,
          newY,
          newZoom,
        });
        alert(`Coordinates out of bounds for zoom level ${newZoom}`);
        return;
      }

      // Update the state with new values
      setZoom(newZoom);
      setX(newX);
      setY(newY);
      const center = tileToLatLng(newZoom, newX + 0.5, newY + 0.5);
      mapRef.current?.setView(center, newZoom, { animate: false });
    } catch (error) {
      console.error('Error processing link:', error);
      alert('Error processing link coordinates');
    }
  };

  const fetchIdentifiers = async (names: string[]) => {
    // If no names are selected, don't fetch
    if (names.length === 0) {
      setIdentifiers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Build URL with multiple name parameters
      const urlParams = new URLSearchParams();
      urlParams.append('service', 'IMAGE');
      urlParams.append('limit', '0');

      // Add each name as a separate parameter
      names.forEach((name) => {
        urlParams.append('name', name);
      });

      const url = `/arbitrary/resources/searchsimple?${urlParams.toString()}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data: { identifier: string; name: string }[] =
        await response.json();
      // Store both identifier and name mapping
      const identifierMappings: IdentifierMapping[] = data.map((item) => ({
        identifier: item.identifier,
        name: item.name,
      }));
      setIdentifiers(identifierMappings);
    } catch (error) {
      console.error('Error fetching the data:', error);
      setIdentifiers([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch identifiers when selectedNames change
  useEffect(() => {
    fetchIdentifiers(addressNames);
  }, [addressNames]);

  // Fetch cartographer names on component mount
  useEffect(() => {
    fetchCartographerAddressAndNames();
  }, []);

  const fetchFollowedNames = useCallback(async () => {
    // Get the followed names list
    try {
      const followedNamesResponse = await qortalRequest({
        action: 'GET_LIST_ITEMS',
        list_name: 'followedNames',
      });

      if (Array.isArray(followedNamesResponse)) {
        setFollowedNames((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(followedNamesResponse))
            return prev;
          return followedNamesResponse;
        });
      }
    } catch (followedNamesError) {
      console.error('Error fetching followed names:', followedNamesError);
      // Don't fail the entire operation if followed names can't be fetched
    }
  }, []);

  useEffect(() => {
    if (auth?.address) {
      fetchFollowedNames();
    }
  }, [auth?.address, fetchFollowedNames]);

  const handlePan = (dx: number, dy: number) => {
    const tileSize = 256;
    mapRef.current?.panBy([dx * tileSize, dy * tileSize], { animate: true });
  };

  const handleZoomIn = () => {
    if (zoom < 20) {
      mapRef.current?.zoomIn(1);
    }
  };

  const handleZoomOut = () => {
    if (zoom > 1) {
      mapRef.current?.zoomOut(1);
    }
  };

  const isButtonDisabled = (
    newX: number,
    newY: number,
    currentZoom: number
  ) => {
    return (
      newX < 0 ||
      newX >= 2 ** currentZoom ||
      newY < 0 ||
      newY >= 2 ** currentZoom
    );
  };

  const fetchImage = useCallback(
    async (identifier: string) => {
      const identifierMapping = identifiers.find(
        (item) => item.identifier === identifier
      );

      if (identifierMapping) {
        try {
          const image64 = await qortalRequest({
            action: 'FETCH_QDN_RESOURCE',
            identifier,
            encoding: 'base64',
            name: identifierMapping.name,
            service: 'IMAGE',
            rebuild: false,
          });

          if (image64.startsWith('data:image/')) {
            return image64;
          } else {
            try {
              window.atob(image64);
              return `data:image/png;base64,${image64}`;
            } catch (e) {
              console.error('Invalid Base64 string:', e);
              return `Error\nInvalid\nBase64\n${identifier}`;
            }
          }
        } catch (error) {
          console.error('Error fetching the image:', error);
          return `Error\nLoading\n${identifier}\n(${identifierMapping.name})`;
        }
      } else {
        return `Missing\nIdentifier\n${identifier}`;
      }
    },
    [identifiers]
  );

  const fetchTileImage = useCallback(
    (z: number, x: number, y: number) => fetchImage(`${z}-${x}-${y}`),
    [fetchImage]
  );

  // Handle Start Freedom Cell wizard submission - prepare for confirmation
  const handleFreedomCellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFreedomCellError('');
    setIsStartingFreedomCell(true);

    // Validate the inputs
    const name = freedomCellName.trim();
    const grpDesc = groupDescription.trim();

    if (!name) {
      setFreedomCellError('Please enter a name for the Freedom Cell');
      setIsStartingFreedomCell(false);
      return;
    }

    if (!grpDesc) {
      setFreedomCellError('Please enter a description for the group');
      setIsStartingFreedomCell(false);
      return;
    }

    try {
      // Create the neighborhood term
      const cellTerm = auth?.name + ` freedom cell`;
      console.log('Freedom Cell term:', cellTerm);

      // Use "idx-cell" as the identifier instead of a prefixed identifier
      const freedomCellIdentifier = 'idx-cell';

      // Build the object with the specified structure
      const newFreedomCellObject = {
        t: cellTerm, // the term (user name + neighborhood)
        n: name, // the name from the group
        c: 901, // the category number (901 for freedom cells group)
      };

      // Store the pending data in state
      setPendingFreedomCellName(name);
      setPendingFreedomCellIdentifier(freedomCellIdentifier);
      setPendingFreedomCellObject(newFreedomCellObject);
      setPendingGroupName(name); // Use the Freedom Cell name for the group name
      setPendingGroupDescription(grpDesc);

      // Close the Freedom Cell modal and show the confirmation modal
      setShowFreedomCellModal(false);
      setShowConfirmationModal(true);
    } catch (error) {
      console.error('Error preparing Freedom Cell:', error);

      // Extract error message from the response if available
      let errorMessage = 'Failed to prepare Freedom Cell';
      if (error && typeof error === 'object') {
        // Check if it's a qortal API response with message field
        // @ts-ignore
        if (error.message) {
          // @ts-ignore
          errorMessage = error.message;
        } else {
          // @ts-ignore
          if (error.error) {
            // @ts-ignore
            errorMessage = error.error;
          }
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      setFreedomCellError(errorMessage);
    } finally {
      setIsStartingFreedomCell(false);
    }

    // Clear the name inputs
    setFreedomCellName('');
    setGroupDescription('');
  };

  // Handle confirmation from the modal
  const handleConfirmFreedomCell = async () => {
    try {
      // Set checking state to true
      setIsCheckingForGroupTransaction(true);

      // First, create the group
      console.log('Creating group with name:', pendingGroupName);
      const groupResponse = await qortalRequest({
        action: 'CREATE_GROUP',
        groupName: pendingGroupName,
        description: pendingGroupDescription,
        type: freedomCellType,
        approvalThreshold: 40,
        minBlock: 5,
        maxBlock: 21600,
      });

      console.log('Group created successfully:', groupResponse);

      // Get the user's address for the transaction search
      const account = await qortalRequest({
        action: 'GET_USER_ACCOUNT',
      });

      console.log('User address for transaction search:', account);

      // Function to check for the group transaction
      const checkForGroupTransaction = async (retryCount = 0) => {
        try {
          // Query for the group transaction
          const searchResponse = await fetch(
            `/transactions/search?txType=CREATE_GROUP&address=${account.address}&confirmationStatus=CONFIRMED&limit=1&reverse=true`
          );

          if (!searchResponse.ok) {
            throw new Error(
              `Network response was not ok: ${searchResponse.status}`
            );
          }

          const transactionData = await searchResponse.json();
          console.log('Transaction search data:', transactionData);

          if (Array.isArray(transactionData) && transactionData.length > 0) {
            const latestTransaction = transactionData[0];

            // Check if the transaction name matches our Freedom Cell name
            if (latestTransaction.groupName === pendingGroupName) {
              console.log(
                'Found matching transaction with groupId:',
                latestTransaction.groupId
              );

              // Update the Freedom Cell object with the groupId
              const updatedFreedomCellObject = {
                ...pendingFreedomCellObject,
                l: latestTransaction.groupId, // Use the groupId as the l value
              };

              console.log(
                'Updated Freedom Cell object:',
                updatedFreedomCellObject
              );

              // Print to console for the Freedom Cell
              console.log(
                'Freedom Cell identifier:',
                pendingFreedomCellIdentifier
              );
              console.log('Freedom Cell object:', updatedFreedomCellObject);

              // Create a JSON array containing the updated Freedom Cell object
              const jsonArray = [updatedFreedomCellObject];
              console.log('JSON array that would be published:', jsonArray);

              // Convert the JSON array to base64
              let dataToBase;
              try {
                dataToBase = await objectToBase64(jsonArray);
              } catch (error) {
                console.error('Base64 encoding error:', error);
                // Fallback to browser's btoa
                dataToBase = btoa(JSON.stringify(jsonArray));
              }

              // Publish the Freedom Cell
              await qortalRequest({
                action: 'PUBLISH_QDN_RESOURCE',
                service: 'JSON',
                identifier: 'idx-cell',
                base64: dataToBase,
              });

              // Set checking state to false
              setIsCheckingForGroupTransaction(false);

              // Close the confirmation modal
              setShowConfirmationModal(false);

              // Show success message
              setFreedomCellSuccess(
                `Freedom Cell "${pendingFreedomCellName}" created successfully!`
              );
              setShowSuccessPanel(true);
            } else {
              console.log(
                'Transaction name does not match:',
                latestTransaction.groupName,
                '!=',
                pendingGroupName
              );

              // If name doesn't match and we haven't exceeded retry limit, wait and retry
              if (retryCount < 100) {
                console.log('Waiting 3 seconds to retry...');
                setTimeout(
                  () => checkForGroupTransaction(retryCount + 1),
                  3000
                );
              } else {
                setIsCheckingForGroupTransaction(false);
                throw new Error(
                  'Failed to find matching group transaction after multiple attempts'
                );
              }
            }
          } else {
            console.log('No transactions found');

            // If no transactions found and we haven't exceeded retry limit, wait and retry
            if (retryCount < 100) {
              console.log('Waiting 3 seconds to retry...');
              setTimeout(() => checkForGroupTransaction(retryCount + 1), 3000);
            } else {
              setIsCheckingForGroupTransaction(false);
              throw new Error(
                'No group transactions found after multiple attempts'
              );
            }
          }
        } catch (error) {
          console.error('Error checking for group transaction:', error);

          // If there's an error and we haven't exceeded retry limit, wait and retry
          if (retryCount < 100) {
            console.log('Waiting 3 seconds to retry after error...');
            setTimeout(() => checkForGroupTransaction(retryCount + 1), 3000);
          } else {
            setIsCheckingForGroupTransaction(false);
            throw error; // Re-throw the error if we've exceeded retry limit
          }
        }
      };

      // Start checking for the group transaction
      await checkForGroupTransaction();
    } catch (error) {
      console.error('Error creating group or Freedom Cell:', error);

      // Set checking state to false
      setIsCheckingForGroupTransaction(false);

      // Type-safe error handling
      let errorMessage = 'Unknown error';
      if (error && typeof error === 'object' && error !== null) {
        // Check if it's a qortal API response with message field
        if ('message' in error && typeof error.message === 'string') {
          errorMessage = error.message;
        } else if ('error' in error && typeof error.error === 'string') {
          errorMessage = error.error;
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      // Close the confirmation modal
      setShowConfirmationModal(false);

      // Show error message
      setFreedomCellError(errorMessage);
      setShowErrorPanel(true);
    }
  };

  // Handle cancellation from the confirmation modal
  const handleCancelFreedomCell = () => {
    setShowConfirmationModal(false);
    setPendingFreedomCellName('');
    setPendingGroupName('');
    setPendingGroupDescription('');
    setPendingFreedomCellIdentifier('');
    setPendingFreedomCellObject(null);
    setIsCheckingForGroupTransaction(false);
  };

  // Handle Index form submission
  const handleIndexSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIndexError('');
    setIndexIdentifier('');
    setBuiltObject(null);
    setIsGeneratingIdentifier(true);

    // Convert term to lowercase and validate
    const lowerCaseTerm = indexTerm.trim().toLowerCase();

    if (!lowerCaseTerm) {
      setIndexError('Please enter a term to index');
      setIsGeneratingIdentifier(false);
      return;
    }

    if (addressNames.length === 0) {
      setIndexError('Please select at least one name');
      setIsGeneratingIdentifier(false);
      return;
    }

    try {
      // Print the lowercase term to console
      console.log('Index term submitted (lowercase):', lowerCaseTerm);

      const entityType = 'post'; // Give a name to the type of data this is in your app. All posts will need to have the same entity type. do not give for example "comments" the entity type "post"

      const parentId = null; // Since there is no parent to posts in our example, we will give it a value of null.

      // Await the Promise and get the identifier string
      const identifier = await buildIdentifier(entityType, parentId); // Will return a unique identifier

      // Add the prefix to the identifier
      const prefixedIdentifier = `idx-loc-${identifier}`;

      // Set the index identifier to display it
      setIndexIdentifier(prefixedIdentifier);

      // Get the upper left tile identifier (first tile in the grid)
      const upperLeftIdentifier = `${zoom}-${x}-${y}`;

      // Find the identifier mapping for the upper left tile to get its name
      const upperLeftMapping = identifiers.find(
        (item) => item.identifier === upperLeftIdentifier
      );

      // Build the object with the specified structure using lowercase term
      const newBuiltObject = {
        t: lowerCaseTerm, // the term in lowercase
        n: upperLeftMapping ? upperLeftMapping.name : 'Unknown', // the name from the upper left tile
        c: 9, // the category number
        l: `${zoom}-${x}-${y}`, // location coordinates separated by dash marks
      };

      setBuiltObject(newBuiltObject);

      // Also log both to console
      console.log('Index identifier:', prefixedIdentifier);
      console.log('Built object:', newBuiltObject);
      console.log('Upper left tile identifier:', upperLeftIdentifier);
      console.log(
        'Upper left tile name:',
        upperLeftMapping ? upperLeftMapping.name : 'Unknown'
      );

      // Create a JSON array containing the newBuiltObject
      const jsonArray = [newBuiltObject];
      console.log('JSON array to be published:', jsonArray);

      // Convert the JSON array to base64
      let dataToBase;
      try {
        dataToBase = await objectToBase64(jsonArray);
      } catch (error) {
        console.error('Base64 encoding error:', error);
        // Fallback to browser's btoa
        dataToBase = btoa(JSON.stringify(jsonArray));
      }

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'JSON',
        identifier: prefixedIdentifier,
        base64: dataToBase,
      });
    } catch (error) {
      console.error('Error generating identifier:', error);
      setIndexError('Failed to generate identifier');
    } finally {
      setIsGeneratingIdentifier(false);
    }

    // Clear the term input but keep the identifier and object displayed
    setIndexTerm('');
  };

  // Handle Set Neighborhood form submission
  const handleSetNeighborhoodSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHoodIndexError('');
    setIsGeneratingHoodIdentifier(true);

    // Get the user's name
    const userName = auth?.name || '';

    if (!userName) {
      setHoodIndexError('User name not available');
      setIsGeneratingHoodIdentifier(false);
      return;
    }

    if (addressNames.length === 0) {
      setHoodIndexError('Please select at least one name');
      setIsGeneratingHoodIdentifier(false);
      return;
    }

    try {
      // Create the neighborhood term
      const hoodTerm = `${userName} neighborhood`;
      console.log('Neighborhood term:', hoodTerm);

      // Fixed: Use "idx-hood" as the identifier instead of a prefixed identifier
      const hoodIdentifier = 'idx-hood';

      // Get the upper left tile identifier (first tile in the grid)
      const upperLeftIdentifier = `${zoom}-${x}-${y}`;

      // Find the identifier mapping for the upper left tile to get its name
      const upperLeftMapping = identifiers.find(
        (item) => item.identifier === upperLeftIdentifier
      );

      // Get the map center lat/lng and zoom from Leaflet
      const mapCenter = mapRef.current?.getCenter();
      const centerLat = mapCenter ? mapCenter.lat : 0;
      const centerLng = mapCenter ? mapCenter.lng : 0;
      const currentZoom = mapRef.current?.getZoom() ?? zoom;

      // Build the object with the specified structure
      const newHoodBuiltObject = {
        t: hoodTerm, // the term (user name + neighborhood)
        n: upperLeftMapping ? upperLeftMapping.name : 'Unknown', // the name from the upper left tile
        c: 901, // the category number (901 for neighborhoods)
        l: `${currentZoom}-${centerLat}-${centerLng}`, // zoom, lat, lng separated by dashes
      };

      setHoodBuiltObject(newHoodBuiltObject);

      // Also log both to console
      console.log('Neighborhood index identifier:', hoodIdentifier);
      console.log('Neighborhood built object:', newHoodBuiltObject);
      console.log('Upper left tile identifier:', upperLeftIdentifier);
      console.log(
        'Upper left tile name:',
        upperLeftMapping ? upperLeftMapping.name : 'Unknown'
      );

      // Create a JSON array containing the newHoodBuiltObject
      const jsonArray = [newHoodBuiltObject];
      console.log('JSON array to be published:', jsonArray);

      // Convert the JSON array to base64
      let dataToBase;
      try {
        dataToBase = await objectToBase64(jsonArray);
      } catch (error) {
        console.error('Base64 encoding error:', error);
        // Fallback to browser's btoa
        dataToBase = btoa(JSON.stringify(jsonArray));
      }

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'JSON',
        identifier: hoodIdentifier,
        base64: dataToBase,
      });

      // Close the modal after successful submission
      setShowSetNeighborhoodModal(false);

      // Refresh the user's neighborhood data
      discoverUserNeighborhood();

      // Update freedomCellsData state: update this user's cell location, or add a new item with group description
      const newLocation = `${currentZoom}-${centerLat}-${centerLng}`;
      const existingCell = freedomCellsData.find((cell) => cell.creator === userName);
      if (existingCell) {
        setFreedomCellsData((prev) =>
          prev.map((cell) =>
            cell.creator === userName ? { ...cell, location: newLocation } : cell
          )
        );
      } else {
        // Fetch group info for description (same as fetchFreedomCellsData)
        let description = '';
        let groupId: number | undefined;
        let cellName = newHoodBuiltObject.n || `${userName}'s Cell`;
        try {
          const nameResponse = await fetch(`/names/${userName}`);
          if (nameResponse.ok) {
            const nameData = await nameResponse.json();
            const cellResponse = await fetch(
              `/arbitrary/JSON/${userName}/idx-cell`
            );
            if (cellResponse.ok) {
              const cellData = await cellResponse.json();
              const cellInfo =
                Array.isArray(cellData) && cellData.length > 0
                  ? cellData[0]
                  : null;
              if (cellInfo?.n) cellName = cellInfo.n;
              const groupsResponse = await fetch(
                `/groups/owner/${nameData.owner}`
              );
              if (groupsResponse.ok) {
                const groupsData = await groupsResponse.json();
                const matchingGroup =
                  cellInfo?.l != null
                    ? groupsData.find(
                        (g: any) =>
                          g.groupId?.toString() === cellInfo.l?.toString()
                      )
                    : null;
                if (matchingGroup) {
                  description = matchingGroup.description ?? '';
                  groupId = matchingGroup.groupId;
                }
              }
            }
          }
        } catch (_) {
          // keep description '' and groupId undefined
        }
        setFreedomCellsData((prev) => [
          ...prev,
          {
            name: cellName,
            location: newLocation,
            description,
            creator: userName,
            timeCreated: new Date().toLocaleString(),
            ...(groupId !== undefined && { groupId }),
          },
        ]);
      }
    } catch (error) {
      console.error('Error generating neighborhood identifier:', error);
      setHoodIndexError('Failed to generate neighborhood identifier');
    } finally {
      setIsGeneratingHoodIdentifier(false);
    }
  };

  // Get theme-specific styles for panels
  const getPanelStyles = () => {
    const isDarkTheme = theme === EnumTheme.DARK;
    return {
      backgroundColor: isDarkTheme ? '#2c2c2c' : '#f9f9f9',
      borderColor: isDarkTheme ? '#444' : '#ddd',
      color: isDarkTheme ? '#e0e0e0' : '#333',
    };
  };

  const panelStyles = getPanelStyles();

  // Freedom cells that fall within the current map bounds (when bounds available)
  const cellsInBounds = useMemo(() => {
    if (!mapBounds) return freedomCellsData;
    return freedomCellsData.filter((cell) => {
      const pos = parseCellLocation(cell.location);
      return pos !== null && mapBounds.contains(pos);
    });
  }, [freedomCellsData, mapBounds]);

  // Debug effect to log neighborhood state changes
  useEffect(() => {
    console.log('Neighborhood state changed:', {
      userNeighborhood,
      neighborhoodLoading,
      neighborhoodError,
    });
  }, [userNeighborhood, neighborhoodLoading, neighborhoodError]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100vh',
        margin: '20px',
      }}
    >
      {/* User Information Header */}
      <div
        style={{
          width: '100%',
          marginBottom: '20px',
          padding: '10px',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
            WELCOME TO THE FREEDOM CELL NETWORK, {auth?.name}!
          </div>
        </div>

        {/* Address Names Button in Upper Right Corner */}
        <button
          onClick={() => {
            setShowAddressNamesModal(true);
            fetchCartographerAddressAndNames();
          }}
          className="address-names-button address-icon"
          title="Show Cartographer Address Names"
          style={{
            width: '250px',
            height: '50px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor:
              addressNames.length > 0 &&
              addressNames.every((name) => followedNames.includes(name))
                ? '#28a745'
                : '#dc3545',
            border: `1px solid ${theme === EnumTheme.DARK ? '#666' : '#ccc'}`,
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: 'white',
            }}
          >
            Map Image Hosting
          </span>
        </button>
      </div>

      {/* Lists Section */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          width: '100%',
          maxWidth: '1200px', // Add this to constrain overall width
          margin: '0 auto', // Center the container
          marginBottom: '20px',
        }}
      >
        {/* Left Column: Forms */}
        <div
          style={{
            flex: '0 0 40%',
            marginRight: '10px',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          }}
        >
          {/* User Neighborhood Panel */}
          <div
            style={{
              padding: '15px',
              maxWidth: '600px',
              border: '1px solid #ddd',
              borderRadius: '5px',
              marginBottom: '20px',
              ...panelStyles,
              flex: '1',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {neighborhoodLoading ? (
              <div style={{ textAlign: 'center', padding: '10px' }}>
                <div
                  className="spinner"
                  style={{
                    width: '20px',
                    height: '20px',
                    margin: '0 auto 10px',
                    borderLeftColor:
                      theme === EnumTheme.DARK ? '#09f' : '#007bff',
                  }}
                ></div>
                <p
                  style={{
                    margin: 0,
                    fontSize: '14px',
                    color: panelStyles.color,
                  }}
                >
                  Loading neighborhood data...
                </p>
              </div>
            ) : neighborhoodError ? (
              <div
                style={{
                  padding: '8px',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  border: '1px solid #f5c6cb',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                Error: {neighborhoodError}
              </div>
            ) : (
              <div
                style={{
                  position: 'relative',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Panel Header with Last Updated */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '10px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '21px',
                      fontWeight: 'bold',
                      color: panelStyles.color,
                    }}
                  >
                    Your Neighborhood
                  </div>
                  {userNeighborhood && userNeighborhood.timestamp && (
                    <div
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 'bold',
                        color: panelStyles.color,
                      }}
                    >
                      Last Updated:{' '}
                      {new Date(
                        parseInt(userNeighborhood.timestamp)
                      ).toLocaleString()}
                    </div>
                  )}
                </div>

                {/* Content area - either neighborhood map or centered message */}
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    position: 'relative',
                  }}
                >
                  {userNeighborhood &&
                  userNeighborhood.t &&
                  userNeighborhood.l ? (
                    (() => {
                      const parts = userNeighborhood.l.split('-');
                      const savedZoom = parseFloat(parts[0]);
                      const lat = parseFloat(parts[1]);
                      const lng = parseFloat(parts[2]);
                      if (isNaN(savedZoom) || isNaN(lat) || isNaN(lng))
                        return null;
                      const hoodCenter: L.LatLngExpression = { lat, lng };
                      const hoodPreviewZoom = Math.max(1, savedZoom - 1);
                      if (!hoodCenter) return null;
                      return (
                        <div
                          style={{
                            width: '256px',
                            height: '256px',
                            overflow: 'hidden',
                            borderRadius: '4px',
                            border: '1px solid var(--modal-border-color, #444)',
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              top: '-128px',
                              left: '-128px',
                              width: '512px',
                              height: '512px',
                            }}
                          >
                            <MapContainer
                              center={hoodCenter}
                              zoom={hoodPreviewZoom}
                              style={{ height: '100%', width: '100%' }}
                              zoomControl={false}
                              attributionControl={false}
                              dragging={false}
                              scrollWheelZoom={false}
                              doubleClickZoom={false}
                              touchZoom={false}
                              keyboard={false}
                              boxZoom={false}
                              maxZoom={20}
                              minZoom={1}
                              maxBounds={[
                                [-85.051129, -180],
                                [85.051129, 180],
                              ]}
                              maxBoundsViscosity={1.0}
                            >
                              <SetPreviewView
                                center={hoodCenter}
                                zoom={hoodPreviewZoom}
                              />
                              <QdnTileLayer fetchTileImage={fetchTileImage} />
                            </MapContainer>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div
                      style={{
                        fontSize: '14px',
                        color: panelStyles.color,
                        fontStyle: 'italic',
                        textAlign: 'center',
                        padding: '20px',
                      }}
                    >
                      No neighborhood set. You must have a neighborhood set to
                      start a freedom cell.
                      <p />
                      First, navigate to your neighborhood on the map.
                      <p />
                      Click "Set Your Neighborhood" to set your neighborhood.
                      <p />
                      You do not need to have a neighborhood set to join someone
                      else's freedom cell.
                    </div>
                  )}
                </div>

                {/* Edit Button - Always show at the bottom */}
                <button
                  onClick={() => setShowSetNeighborhoodModal(true)}
                  className="edit-button"
                  title={
                    userNeighborhood && userNeighborhood.t
                      ? 'Reset Your Neighborhood'
                      : 'Set Your Neighborhood'
                  }
                  style={{
                    width: '100%',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '8px 16px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    marginTop: '10px',
                  }}
                >
                  {userNeighborhood && userNeighborhood.t
                    ? 'Reset Your Neighborhood'
                    : 'Set Your Neighborhood'}
                </button>
              </div>
            )}
          </div>

          {/* Start Freedom Cell Panel - Just a button */}
          <div
            style={{
              padding: '15px',
              maxWidth: '600px',
              border: '1px solid #ddd',
              borderRadius: '5px',
              marginBottom: '20px',
              ...panelStyles,
            }}
          >
            <button
              onClick={() => setShowFreedomCellModal(true)}
              disabled={!userNeighborhood || !userNeighborhood.t}
              style={{
                width: '100%',
                padding: '15px',
                backgroundColor:
                  !userNeighborhood || !userNeighborhood.t
                    ? '#6c757d'
                    : '#6f42c1',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor:
                  !userNeighborhood || !userNeighborhood.t
                    ? 'not-allowed'
                    : 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
              }}
            >
              {hasExistingFreedomCell
                ? 'Replace Freedom Cell'
                : 'Start Freedom Cell'}
            </button>
          </div>
        </div>

        {/* Right Column: Map */}
        <div
          style={{
            flex: '0 0 60%',
            marginLeft: '10px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Map Section */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {/* Status Message */}
            {addressNames.length === 0 && (
              <div
                style={{
                  marginBottom: '20px',
                  padding: '10px',
                  backgroundColor: '#fff3cd',
                  border: '1px solid #ffeaa7',
                  borderRadius: '4px',
                  textAlign: 'center',
                }}
              >
                No Cartographer names found to load the map
              </div>
            )}

            {/* Map Container with Integrated Controls */}
            <div
              style={{ position: 'relative', width: '550px', height: '550px' }}
            >
              {/* Leaflet Map Container */}
              <div
                style={{
                  position: 'absolute',
                  top: '20px',
                  left: '20px',
                  right: '20px',
                  bottom: '20px',
                  overflow: 'hidden',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  zIndex: 0,
                }}
              >
                {loading ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                    }}
                  >
                    <p>Fetching map identifiers...</p>
                    <div className="spinner"></div>
                  </div>
                ) : addressNames.length === 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: '#999',
                    }}
                  >
                    <p>No names selected</p>
                    <p>Waiting for Cartographer names to load...</p>
                  </div>
                ) : (
                  <MapContainer
                    center={[0, 0]}
                    zoom={zoom}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false}
                    attributionControl={false}
                    maxZoom={20}
                    minZoom={1}
                    maxBounds={[
                      [-85.051129, -180],
                      [85.051129, 180],
                    ]}
                    maxBoundsViscosity={1.0}
                  >
                    <MapViewSync
                      zoom={zoom}
                      x={x}
                      y={y}
                      setZoom={setZoom}
                      setX={setX}
                      setY={setY}
                      mapRef={mapRef}
                    />
                    <QdnTileLayer fetchTileImage={fetchTileImage} />
                    <MapBoundsReporter onBoundsChange={setMapBounds} />
                    <FreedomCellMarkersLayer
                      cells={cellsInBounds}
                      zoom={zoom}
                    />
                  </MapContainer>
                )}
              </div>

              {/* Home Button - Upper Left Corner */}
              <button
                onClick={navigateToNeighborhood}
                disabled={!userNeighborhood || !userNeighborhood.l}
                className="home-button home-icon"
                title="Navigate to Neighborhood"
                style={{ position: 'absolute', top: '0', left: '0' }}
              ></button>

              {/* Zoom Controls - Top Right Corner */}
              <div
                style={{
                  position: 'absolute',
                  top: '0',
                  right: '0',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <button
                  onClick={handleZoomIn}
                  disabled={zoom >= 20 || addressNames.length === 0}
                  className="zoom-button zoom-plus"
                  title="Zoom In"
                  style={{ borderRadius: '4px 4px 0 0' }}
                ></button>
                <button
                  onClick={handleZoomOut}
                  disabled={zoom <= 1 || addressNames.length === 0}
                  className="zoom-button zoom-minus"
                  title="Zoom Out"
                  style={{ borderRadius: '0 0 4px 4px', marginTop: '1px' }}
                ></button>
              </div>

              {/* Arrow Controls - Centered on Edges */}
              <button
                onClick={() => handlePan(0, -1)}
                disabled={
                  isButtonDisabled(x, y - 1, zoom) || addressNames.length === 0
                }
                className="arrow-button arrow-up"
                title="Pan Up"
                style={{
                  position: 'absolute',
                  top: '0',
                  left: '50%',
                  transform: 'translateX(-50%)',
                }}
              ></button>

              <button
                onClick={() => handlePan(-1, 0)}
                disabled={
                  isButtonDisabled(x - 1, y, zoom) || addressNames.length === 0
                }
                className="arrow-button arrow-left"
                title="Pan Left"
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              ></button>

              <button
                onClick={() => handlePan(1, 0)}
                disabled={
                  isButtonDisabled(x + 1, y, zoom) || addressNames.length === 0
                }
                className="arrow-button arrow-right"
                title="Pan Right"
                style={{
                  position: 'absolute',
                  right: '0',
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              ></button>

              <button
                onClick={() => handlePan(0, 1)}
                disabled={
                  isButtonDisabled(x, y + 1, zoom) || addressNames.length === 0
                }
                className="arrow-button arrow-down"
                title="Pan Down"
                style={{
                  position: 'absolute',
                  bottom: '0',
                  left: '50%',
                  transform: 'translateX(-50%)',
                }}
              ></button>

              {/* Search Button - Bottom Left Corner */}
              <button
                onClick={() => setShowSearchPanel(true)}
                className="search-button search-icon"
                title="Open Search"
                style={{ position: 'absolute', bottom: '0', left: '0' }}
              ></button>

              {/* Index Button - Bottom Right Corner */}
              <button
                onClick={() => setShowIndexPanel(true)}
                className="index-button index-icon"
                title="Open Index"
                style={{ position: 'absolute', bottom: '0', right: '0' }}
              ></button>
            </div>
          </div>
        </div>
      </div>

      {/* Address Names Modal */}
      {showAddressNamesModal && (
        <div
          className={theme === EnumTheme.DARK ? 'dark-theme' : 'light-theme'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '500px',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: 'var(--modal-bg-color, #2c2c2c)',
              color: 'var(--modal-text-color, #e0e0e0)',
              border: '1px solid var(--modal-border-color, #444)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px',
              }}
            >
              <h4
                style={{
                  margin: 0,
                  color: 'var(--modal-text-color, #e0e0e0)',
                }}
              >
                Please select the following map data publishers to increase map
                image availability for yourself and others on the Qortal Data
                Network (QDN). Once you do, your node will periodically fetch
                the images from these publishers and store them with the rest of
                your data.
              </h4>
              <button
                onClick={() => setShowAddressNamesModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: 'var(--modal-text-color, #e0e0e0)',
                }}
              >
                &times;
              </button>
            </div>

            {addressNamesLoading ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <div
                  className="spinner"
                  style={{ margin: '0 auto 10px' }}
                ></div>
                <p
                  style={{
                    margin: 0,
                    color: 'var(--modal-text-color, #e0e0e0)',
                  }}
                >
                  Fetching address names...
                </p>
              </div>
            ) : addressNamesError ? (
              <div
                style={{
                  padding: '10px',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  border: '1px solid #f5c6cb',
                  borderRadius: '4px',
                  fontSize: '14px',
                  textAlign: 'center',
                }}
              >
                {addressNamesError}
              </div>
            ) : (
              <div>
                <div
                  style={{
                    marginBottom: '10px',
                    fontSize: '14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <strong>Names ({addressNames.length}):</strong>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      id="select-all"
                      checked={
                        addressNames.length > 0 &&
                        addressNames.every((name) =>
                          followedNames.includes(name)
                        )
                      }
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      style={{
                        marginRight: '5px',
                        width: '14px',
                        height: '14px',
                      }}
                    />
                    <label htmlFor="select-all" style={{ cursor: 'pointer' }}>
                      Select All
                    </label>
                  </div>
                </div>

                {addressNames.length > 0 ? (
                  <div
                    style={{
                      maxHeight: '300px',
                      overflowY: 'auto',
                      border: '1px solid var(--modal-border-color, #444)',
                      borderRadius: '4px',
                      padding: '10px',
                    }}
                  >
                    {addressNames
                      .slice()
                      .sort((a, b) => {
                        const aFollowed = followedNames.includes(a);
                        const bFollowed = followedNames.includes(b);
                        if (!aFollowed && bFollowed) return -1;
                        if (aFollowed && !bFollowed) return 1;
                        return a.localeCompare(b);
                      })
                      .map((name, index) => {
                        const isFollowed = followedNames.includes(name);
                        return (
                          <div
                            key={name}
                            style={{
                              padding: '8px',
                              borderBottom:
                                index < addressNames.length - 1
                                  ? '1px solid var(--modal-border-color, #444)'
                                  : 'none',
                              fontSize: '14px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <input
                              type="checkbox"
                              id={`name-${name}`}
                              checked={isFollowed}
                              onChange={(e) =>
                                handleCheckboxChange(name, e.target.checked)
                              }
                              style={{
                                marginRight: '10px',
                                width: '16px',
                                height: '16px',
                              }}
                            />
                            <label
                              htmlFor={`name-${name}`}
                              style={{
                                cursor: 'pointer',
                                color: 'var(--modal-text-color, #e0e0e0)',
                                flex: 1,
                              }}
                            >
                              {name}
                            </label>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '10px',
                      fontSize: '14px',
                      fontStyle: 'italic',
                      textAlign: 'center',
                      color: 'var(--modal-text-color, #e0e0e0)',
                    }}
                  >
                    No names found for this address
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: '15px', textAlign: 'center' }}>
              <button
                onClick={() => setShowAddressNamesModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Neighborhood Modal */}
      {showSetNeighborhoodModal && (
        <div
          className={theme === EnumTheme.DARK ? 'dark-theme' : 'light-theme'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '500px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: 'var(--modal-bg-color, #2c2c2c)',
              color: 'var(--modal-text-color, #e0e0e0)',
              border: '1px solid var(--modal-border-color, #444)',
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: '15px',
                textAlign: 'center',
                color: 'var(--modal-text-color, #e0e0e0)',
              }}
            >
              Your Neighborhood
            </h2>

            <div
              style={{
                position: 'relative',
                width: '256px',
                height: '256px',
                margin: '0 auto 20px',
                overflow: 'hidden',
                borderRadius: '4px',
                border: '1px solid var(--modal-border-color, #444)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-128px',
                  left: '-128px',
                  width: '512px',
                  height: '512px',
                }}
              >
                <MapContainer
                  center={
                    mapRef.current?.getCenter() ??
                    tileToLatLng(zoom, x + 0.5, y + 0.5)
                  }
                  zoom={mapRef.current?.getZoom() ?? zoom}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={false}
                  attributionControl={false}
                  dragging={false}
                  scrollWheelZoom={false}
                  doubleClickZoom={false}
                  touchZoom={false}
                  keyboard={false}
                  boxZoom={false}
                  maxZoom={20}
                  minZoom={1}
                  maxBounds={[
                    [-85.051129, -180],
                    [85.051129, 180],
                  ]}
                  maxBoundsViscosity={1.0}
                >
                  <SetPreviewView
                    center={
                      mapRef.current?.getCenter() ??
                      tileToLatLng(zoom, x + 0.5, y + 0.5)
                    }
                    zoom={Math.max(1, (mapRef.current?.getZoom() ?? zoom) - 1)}
                  />
                  <QdnTileLayer fetchTileImage={fetchTileImage} />
                </MapContainer>
              </div>
            </div>

            <div
              style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}
            >
              <button
                onClick={() => setShowSetNeighborhoodModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSetNeighborhoodSubmit}
                disabled={isGeneratingHoodIdentifier}
                style={{
                  padding: '8px 16px',
                  backgroundColor: isGeneratingHoodIdentifier
                    ? '#6c757d'
                    : '#6f42c1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isGeneratingHoodIdentifier
                    ? 'not-allowed'
                    : 'pointer',
                  fontSize: '14px',
                }}
              >
                {isGeneratingHoodIdentifier ? 'Setting...' : 'Confirm'}
              </button>
            </div>

            {hoodIndexError && (
              <div
                style={{
                  marginTop: '15px',
                  padding: '8px',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  border: '1px solid #f5c6cb',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                {hoodIndexError}
              </div>
            )}

            {/* Display Neighborhood Built Object */}
            {hoodBuiltObject && (
              <div
                style={{
                  marginTop: '15px',
                  padding: '10px',
                  backgroundColor: '#e2e3e5',
                  color: '#383d41',
                  border: '1px solid #d6d8db',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                  Neighborhood Set!
                </div>
                <div
                  style={{
                    wordBreak: 'break-all',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    padding: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderRadius: '3px',
                    border: '1px solid #b8daff',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {JSON.stringify(hoodBuiltObject, null, 2)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Freedom Cell Modal */}
      {showFreedomCellModal && (
        <div
          className={theme === EnumTheme.DARK ? 'dark-theme' : 'light-theme'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '500px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: 'var(--modal-bg-color, #2c2c2c)',
              color: 'var(--modal-text-color, #e0e0e0)',
              border: '1px solid var(--modal-border-color, #444)',
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: '15px',
                textAlign: 'center',
                color: 'var(--modal-text-color, #e0e0e0)',
              }}
            >
              {hasExistingFreedomCell
                ? 'Replace Freedom Cell'
                : 'Start Freedom Cell'}
            </h2>

            {hasExistingFreedomCell && (
              <div
                style={{
                  padding: '10px',
                  backgroundColor: '#fff3cd',
                  color: '#856404',
                  border: '1px solid #ffeeba',
                  borderRadius: '4px',
                  fontSize: '14px',
                  marginBottom: '15px',
                }}
              >
                <strong>Warning:</strong> Your current Freedom Cell will still
                exist as a group on Qortal, but it will no longer be classified
                as a Freedom Cell once this new Freedom Cell is started.
              </div>
            )}

            <form onSubmit={handleFreedomCellSubmit}>
              <div style={{ marginBottom: '15px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '5px',
                    fontSize: '14px',
                    color: 'var(--modal-text-color, #e0e0e0)',
                  }}
                >
                  Freedom Cell Name:
                </label>
                <input
                  type="text"
                  value={freedomCellName}
                  onChange={(e) => {
                    if (e.target.value.length <= 32) {
                      setFreedomCellName(e.target.value);
                    }
                  }}
                  maxLength={32}
                  placeholder="Enter Freedom Cell name"
                  disabled={isStartingFreedomCell}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    fontSize: '14px',
                    backgroundColor:
                      theme === EnumTheme.DARK
                        ? '#444'
                        : isStartingFreedomCell
                          ? '#f5f5f5'
                          : 'white',
                    color: theme === EnumTheme.DARK ? '#e0e0e0' : '#333',
                  }}
                />
                <div
                  style={{
                    textAlign: 'right',
                    fontSize: '12px',
                    marginTop: '4px',
                    color:
                      freedomCellName.length >= 32
                        ? '#dc3545'
                        : freedomCellName.length >= 26
                          ? '#ffc107'
                          : 'var(--modal-text-color, #999)',
                  }}
                >
                  {freedomCellName.length}/32
                </div>
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '5px',
                    color: 'var(--modal-text-color, #e0e0e0)',
                  }}
                >
                  Freedom Cell Description *
                </label>
                <textarea
                  value={groupDescription}
                  onChange={(e) => {
                    if (e.target.value.length <= 120) {
                      setGroupDescription(e.target.value);
                    }
                  }}
                  maxLength={120}
                  placeholder="Enter freedom cell description"
                  required
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: `1px solid ${theme === EnumTheme.DARK ? '#666' : '#ced4da'}`,
                    backgroundColor: 'var(--modal-input-bg-color, #3a3a3a)',
                    color: 'var(--modal-input-text-color, #e0e0e0)',
                    minHeight: '80px',
                    resize: 'vertical',
                  }}
                />
                <div
                  style={{
                    textAlign: 'right',
                    fontSize: '12px',
                    marginTop: '4px',
                    color:
                      groupDescription.length >= 120
                        ? '#dc3545'
                        : groupDescription.length >= 100
                          ? '#ffc107'
                          : 'var(--modal-text-color, #999)',
                  }}
                >
                  {groupDescription.length}/120
                </div>
              </div>

              <div style={{ marginBottom: '15px' }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="freedomCellType"
                      value={GroupType.CLOSED}
                      checked={freedomCellType === GroupType.CLOSED}
                      onChange={() => setFreedomCellType(GroupType.CLOSED)}
                      disabled={isStartingFreedomCell}
                      style={{ marginRight: '8px' }}
                    />
                    <span style={{ fontSize: '14px' }}>
                      Closed (private) - users need permission to join
                    </span>
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="freedomCellType"
                      value={GroupType.OPEN}
                      checked={freedomCellType === GroupType.OPEN}
                      onChange={() => setFreedomCellType(GroupType.OPEN)}
                      disabled={isStartingFreedomCell}
                      style={{ marginRight: '8px' }}
                    />
                    <span style={{ fontSize: '14px' }}>Open (public)</span>
                  </label>
                </div>
              </div>

              {freedomCellError && (
                <div
                  style={{
                    marginBottom: '15px',
                    padding: '8px',
                    backgroundColor: '#f8d7da',
                    color: '#721c24',
                    border: '1px solid #f5c6cb',
                    borderRadius: '4px',
                    fontSize: '14px',
                  }}
                >
                  {freedomCellError}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowFreedomCellModal(false)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isStartingFreedomCell}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: isStartingFreedomCell
                      ? '#6c757d'
                      : '#6f42c1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isStartingFreedomCell ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                  }}
                >
                  {isStartingFreedomCell
                    ? hasExistingFreedomCell
                      ? 'Replacing...'
                      : 'Creating...'
                    : hasExistingFreedomCell
                      ? 'Replace Cell'
                      : 'Create Cell'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Freedom Cell Confirmation Modal */}
      {showConfirmationModal && (
        <div
          className={theme === EnumTheme.DARK ? 'dark-theme' : 'light-theme'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '400px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: 'var(--modal-bg-color, #2c2c2c)',
              color: 'var(--modal-text-color, #e0e0e0)',
              border: '1px solid var(--modal-border-color, #444)',
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: '15px',
                textAlign: 'center',
                color: 'var(--modal-text-color, #e0e0e0)',
              }}
            >
              {pendingFreedomCellName}
            </h2>

            {isCheckingForGroupTransaction ? (
              <div style={{ marginBottom: '15px' }}>
                <div
                  style={{
                    fontSize: '14px',
                    textAlign: 'center',
                    marginBottom: '10px',
                  }}
                >
                  PLEASE WAIT! You'll need to accept one more data publish
                  before your Freedom Cell is complete...
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '4px',
                    backgroundColor:
                      theme === EnumTheme.DARK ? '#444' : '#e9ecef',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      height: '100%',
                      width: '30%',
                      backgroundColor: '#6f42c1',
                      borderRadius: '2px',
                      animation:
                        'indeterminateProgress 1.5s infinite ease-in-out',
                    }}
                  ></div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '15px', fontSize: '14px' }}>
                  <strong>Group:</strong> {pendingGroupName}
                </div>

                {pendingGroupDescription && (
                  <div style={{ marginBottom: '15px', fontSize: '14px' }}>
                    <strong>Description:</strong> {pendingGroupDescription}
                  </div>
                )}

                <div style={{ marginBottom: '15px', fontSize: '14px' }}>
                  {freedomCellType === 0 ? 'Closed (private)' : 'Open (public)'}
                </div>
              </>
            )}

            <div
              style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}
            >
              <button
                onClick={handleCancelFreedomCell}
                disabled={isCheckingForGroupTransaction}
                style={{
                  padding: '8px 16px',
                  backgroundColor: isCheckingForGroupTransaction
                    ? '#6c757d'
                    : '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isCheckingForGroupTransaction
                    ? 'not-allowed'
                    : 'pointer',
                  fontSize: '14px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmFreedomCell}
                disabled={isCheckingForGroupTransaction}
                style={{
                  padding: '8px 16px',
                  backgroundColor: isCheckingForGroupTransaction
                    ? '#6c757d'
                    : '#6f42c1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isCheckingForGroupTransaction
                    ? 'not-allowed'
                    : 'pointer',
                  fontSize: '14px',
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Freedom Cell Error Panel Modal */}
      {showErrorPanel && (
        <div
          className={theme === EnumTheme.DARK ? 'dark-theme' : 'light-theme'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '400px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: 'var(--modal-bg-color, #2c2c2c)',
              color: 'var(--modal-text-color, #e0e0e0)',
              border: '1px solid var(--modal-border-color, #444)',
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: '15px',
                textAlign: 'center',
                color: '#dc3545',
              }}
            >
              Error
            </h2>

            <div
              style={{
                marginBottom: '20px',
                fontSize: '14px',
                textAlign: 'center',
              }}
            >
              {freedomCellError}
            </div>

            <div
              style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}
            >
              <button
                onClick={() => {
                  setShowErrorPanel(false);
                  // Reset the error message
                  setFreedomCellError('');
                  // Clear the pending data
                  setPendingFreedomCellName('');
                  setPendingFreedomCellIdentifier('');
                  setPendingFreedomCellObject(null);
                  setPendingGroupName('');
                  setPendingGroupDescription('');
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Freedom Cell Success Panel Modal */}
      {showSuccessPanel && (
        <div
          className={theme === EnumTheme.DARK ? 'dark-theme' : 'light-theme'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '400px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: 'var(--modal-bg-color, #2c2c2c)',
              color: 'var(--modal-text-color, #e0e0e0)',
              border: '1px solid var(--modal-border-color, #444)',
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: '15px',
                textAlign: 'center',
                color: '#28a745',
              }}
            >
              Success
            </h2>

            <div
              style={{
                marginBottom: '20px',
                fontSize: '14px',
                textAlign: 'center',
              }}
            >
              {freedomCellSuccess}
            </div>

            <div
              style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}
            >
              <button
                onClick={() => {
                  setShowSuccessPanel(false);
                  // Reset the success message
                  setFreedomCellSuccess('');
                  // Clear the pending data
                  setPendingFreedomCellName('');
                  setPendingFreedomCellIdentifier('');
                  setPendingFreedomCellObject(null);
                  setPendingGroupName('');
                  setPendingGroupDescription('');
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Panel Modal */}
      {showSearchPanel && (
        <div
          className={theme === EnumTheme.DARK ? 'dark-theme' : 'light-theme'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '600px',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: 'var(--modal-bg-color, #2c2c2c)',
              color: 'var(--modal-text-color, #e0e0e0)',
              border: '1px solid var(--modal-border-color, #444)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  color: 'var(--modal-text-color, #e0e0e0)',
                }}
              >
                Search
              </h2>
              <button
                onClick={() => setShowSearchPanel(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: 'var(--modal-text-color, #e0e0e0)',
                }}
              >
                &times;
              </button>
            </div>

            <form
              onSubmit={handleSearchQuerySubmit}
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-end',
                marginBottom: '15px',
              }}
            >
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '5px',
                    fontSize: '14px',
                    color: 'var(--modal-text-color, #e0e0e0)',
                  }}
                >
                  Search Term:
                </label>
                <input
                  type="text"
                  value={searchQueryTerm}
                  onChange={(e) => setSearchQueryTerm(e.target.value)}
                  placeholder="Enter search term"
                  disabled={isSearching}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    fontSize: '14px',
                    backgroundColor:
                      theme === EnumTheme.DARK
                        ? '#444'
                        : isSearching
                          ? '#f5f5f5'
                          : 'white',
                    color: theme === EnumTheme.DARK ? '#e0e0e0' : '#333',
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={isSearching}
                style={{
                  padding: '8px 16px',
                  backgroundColor: isSearching ? '#6c757d' : '#17a2b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isSearching ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                }}
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </form>

            {searchQueryError && (
              <div
                style={{
                  marginBottom: '15px',
                  padding: '8px',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  border: '1px solid #f5c6cb',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                {searchQueryError}
              </div>
            )}

            <SearchResultsList
              searchResults={searchResults}
              onLinkClick={handleLinkClick}
            />

            <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
              Search indices for terms - filtered by category 9, sorted by score
              (descending). Click links to navigate.
            </div>
          </div>
        </div>
      )}

      {/* Index Panel Modal */}
      {showIndexPanel && (
        <div
          className={theme === EnumTheme.DARK ? 'dark-theme' : 'light-theme'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '600px',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              backgroundColor: 'var(--modal-bg-color, #2c2c2c)',
              color: 'var(--modal-text-color, #e0e0e0)',
              border: '1px solid var(--modal-border-color, #444)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  color: 'var(--modal-text-color, #e0e0e0)',
                }}
              >
                Index
              </h2>
              <button
                onClick={() => setShowIndexPanel(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: 'var(--modal-text-color, #e0e0e0)',
                }}
              >
                &times;
              </button>
            </div>

            <form
              onSubmit={handleIndexSubmit}
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-end',
                marginBottom: '15px',
              }}
            >
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '5px',
                    fontSize: '14px',
                    color: 'var(--modal-text-color, #e0e0e0)',
                  }}
                >
                  Term:
                </label>
                <input
                  type="text"
                  value={indexTerm}
                  onChange={(e) => setIndexTerm(e.target.value)}
                  placeholder="Enter term to index"
                  disabled={isGeneratingIdentifier}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    fontSize: '14px',
                    backgroundColor:
                      theme === EnumTheme.DARK
                        ? '#444'
                        : isGeneratingIdentifier
                          ? '#f5f5f5'
                          : 'white',
                    color: theme === EnumTheme.DARK ? '#e0e0e0' : '#333',
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={isGeneratingIdentifier}
                style={{
                  padding: '8px 16px',
                  backgroundColor: isGeneratingIdentifier
                    ? '#6c757d'
                    : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isGeneratingIdentifier ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                }}
              >
                {isGeneratingIdentifier ? 'Generating...' : 'Index'}
              </button>
            </form>

            {indexError && (
              <div
                style={{
                  marginBottom: '15px',
                  padding: '8px',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  border: '1px solid #f5c6cb',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                {indexError}
              </div>
            )}

            {/* Display Index Identifier */}
            {indexIdentifier && (
              <div
                style={{
                  marginBottom: '15px',
                  padding: '10px',
                  backgroundColor: '#d4edda',
                  color: '#155724',
                  border: '1px solid #c3e6cb',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                  Index Identifier:
                </div>
                <div
                  style={{
                    wordBreak: 'break-all',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    padding: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderRadius: '3px',
                    border: '1px solid #b8daff',
                  }}
                >
                  {indexIdentifier}
                </div>
              </div>
            )}

            {/* Display Built Object */}
            {builtObject && (
              <div
                style={{
                  marginBottom: '15px',
                  padding: '10px',
                  backgroundColor: '#cce5ff',
                  color: '#004085',
                  border: '1px solid #99d6ff',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                  Built Object:
                </div>
                <div
                  style={{
                    wordBreak: 'break-all',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    padding: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderRadius: '3px',
                    border: '1px solid #b8daff',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {JSON.stringify(builtObject, null, 2)}
                </div>
              </div>
            )}

            <div style={{ fontSize: '12px', color: '#666' }}>
              Enter a term to generate a unique index identifier and build
              object
            </div>
          </div>
        </div>
      )}

      {/* Freedom Cells Data Table */}
      <div
        style={{
          width: '100%',
          maxWidth: '1200px',
          margin: '20px auto',
          padding: '15px',
          border: '1px solid #ddd',
          borderRadius: '5px',
          ...panelStyles,
        }}
      >
        <h2
          style={{
            marginTop: 0,
            marginBottom: '15px',
            textAlign: 'center',
            color: panelStyles.color,
          }}
        >
          Freedom Cells
        </h2>

        {freedomCellsLoading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div className="spinner" style={{ margin: '0 auto 10px' }}></div>
            <p style={{ margin: 0, color: panelStyles.color }}>
              Loading Freedom Cells data...
            </p>
          </div>
        ) : freedomCellsError ? (
          <div
            style={{
              padding: '10px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              border: '1px solid #f5c6cb',
              borderRadius: '4px',
              fontSize: '14px',
              textAlign: 'center',
            }}
          >
            {freedomCellsError}
          </div>
        ) : freedomCellsData.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '20px',
              color: panelStyles.color,
            }}
          >
            No Freedom Cells found
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {mapBounds && (
              <p
                style={{
                  fontSize: '12px',
                  color: panelStyles.color,
                  marginBottom: '8px',
                }}
              >
                Showing {cellsInBounds.length} of {freedomCellsData.length}{' '}
                cells in map view
              </p>
            )}
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '14px',
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor:
                      theme === EnumTheme.DARK ? '#444' : '#f2f2f2',
                  }}
                >
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      borderBottom: '1px solid #ddd',
                      color: panelStyles.color,
                    }}
                  >
                    Freedom Cell Name
                  </th>
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      borderBottom: '1px solid #ddd',
                      color: panelStyles.color,
                    }}
                  >
                    Location
                  </th>
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      borderBottom: '1px solid #ddd',
                      color: panelStyles.color,
                    }}
                  >
                    Description
                  </th>
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      borderBottom: '1px solid #ddd',
                      color: panelStyles.color,
                    }}
                  >
                    Creator
                  </th>
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      borderBottom: '1px solid #ddd',
                      color: panelStyles.color,
                    }}
                  >
                    Time Created
                  </th>
                  <th
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      borderBottom: '1px solid #ddd',
                      color: panelStyles.color,
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {cellsInBounds.map((cell, index) => (
                  <tr
                    key={index}
                    style={{
                      backgroundColor:
                        index % 2 === 0
                          ? theme === EnumTheme.DARK
                            ? '#333'
                            : '#ffffff'
                          : theme === EnumTheme.DARK
                            ? '#3a3a3a'
                            : '#f9f9f9',
                    }}
                  >
                    <td
                      style={{
                        padding: '10px',
                        borderBottom: '1px solid #ddd',
                        color: panelStyles.color,
                      }}
                    >
                      {cell.name}
                    </td>
                    <td
                      style={{
                        padding: '10px',
                        borderBottom: '1px solid #ddd',
                        color: panelStyles.color,
                      }}
                    >
                      <button
                        onClick={() => {
                          try {
                            console.log(
                              'Navigating to location:',
                              cell.location
                            );

                            const parts = cell.location.split('-');
                            const newZoom = parseFloat(parts[0]);
                            const lat = parseFloat(parts[1]);
                            const lng = parseFloat(parts[2]);
                            if (isNaN(newZoom) || isNaN(lat) || isNaN(lng)) {
                              showErrorModal('Invalid coordinates in location');
                              return;
                            }
                            mapRef.current?.setView([lat, lng], newZoom, {
                              animate: false,
                            });
                          } catch (error) {
                            console.error('Error processing location:', error);
                            showErrorModal(
                              'Error processing location coordinates'
                            );
                          }
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor:
                            theme === EnumTheme.DARK ? '#28a745' : '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          transition: 'background-color 0.2s',
                        }}
                        title={`Navigate to ${cell.location}`}
                      >
                        Navigate
                      </button>
                    </td>
                    <td
                      style={{
                        padding: '10px',
                        borderBottom: '1px solid #ddd',
                        color: panelStyles.color,
                        maxWidth: '300px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={cell.description}
                    >
                      {cell.description}
                    </td>
                    <td
                      style={{
                        padding: '10px',
                        borderBottom: '1px solid #ddd',
                        color: panelStyles.color,
                      }}
                    >
                      {cell.creator}
                    </td>
                    <td
                      style={{
                        padding: '10px',
                        borderBottom: '1px solid #ddd',
                        color: panelStyles.color,
                      }}
                    >
                      {cell.timeCreated}
                    </td>
                    <td
                      style={{
                        padding: '10px',
                        borderBottom: '1px solid #ddd',
                        color: panelStyles.color,
                      }}
                    >
                      <button
                        onClick={async () => {
                          try {
                            console.log(
                              `Joining group: ${cell.name} (ID: ${cell.groupId})`
                            );
                            await qortalRequest({
                              action: 'JOIN_GROUP',
                              groupId: cell.groupId,
                            });

                            showSuccessModal(
                              `Successfully joined ${cell.name} group!`
                            );
                          } catch (error) {
                            console.error('Error joining group:', error);

                            // Type-safe error handling
                            let errorMessage = 'Unknown error';
                            if (
                              error &&
                              typeof error === 'object' &&
                              error !== null
                            ) {
                              // Check if it's a qortal API response with message field
                              if (
                                'message' in error &&
                                typeof error.message === 'string'
                              ) {
                                errorMessage = error.message;
                              } else if (
                                'error' in error &&
                                typeof error.error === 'string'
                              ) {
                                errorMessage = error.error;
                              }
                            } else if (typeof error === 'string') {
                              errorMessage = error;
                            }

                            showErrorModal(
                              `Failed to join ${cell.name} group: ${errorMessage}`
                            );
                          }
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor:
                            theme === EnumTheme.DARK ? '#28a745' : '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseOver={handleButtonMouseOver}
                        onMouseOut={handleButtonMouseOut}
                        title={`Join ${cell.name} group`}
                      >
                        Join
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Custom Modal Component */}
            {modalState.isOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  zIndex: 1000,
                }}
                onClick={closeModal}
              >
                <div
                  style={{
                    backgroundColor: theme === EnumTheme.DARK ? '#333' : '#fff',
                    color: panelStyles.color,
                    borderRadius: '8px',
                    padding: '20px',
                    maxWidth: '500px',
                    width: '90%',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    border: `1px solid ${theme === EnumTheme.DARK ? '#555' : '#ddd'}`,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '15px',
                      borderBottom: `1px solid ${theme === EnumTheme.DARK ? '#555' : '#ddd'}`,
                      paddingBottom: '10px',
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        color:
                          modalState.type === 'error' ? '#dc3545' : '#28a745',
                        fontSize: '18px',
                        fontWeight: 'bold',
                      }}
                    >
                      {modalState.type === 'error' ? 'Error' : 'Success'}
                    </h3>
                    <button
                      onClick={closeModal}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '20px',
                        cursor: 'pointer',
                        color: panelStyles.color,
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div
                    style={{
                      marginBottom: '20px',
                      fontSize: '16px',
                      lineHeight: '1.5',
                    }}
                  >
                    {modalState.message}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <button
                      onClick={closeModal}
                      style={{
                        padding: '8px 16px',
                        backgroundColor:
                          modalState.type === 'error' ? '#dc3545' : '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseOver={(e) => {
                        const button = e.currentTarget; // Use currentTarget instead of target
                        button.style.backgroundColor =
                          modalState.type === 'error' ? '#c82333' : '#218838';
                      }}
                      onMouseOut={(e) => {
                        const button = e.currentTarget; // Use currentTarget instead of target
                        button.style.backgroundColor =
                          modalState.type === 'error' ? '#dc3545' : '#28a745';
                      }}
                    >
                      {modalState.type === 'error' ? 'Close' : 'OK'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        .spinner {
          border: 4px solid rgba(0, 0, 0, 0.1);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border-left-color: #09f;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        /* Dark theme styles for the modal */
        .dark-theme {
          --modal-bg-color: #2c2c2c;
          --modal-text-color: #e0e0e0;
          --modal-border-color: #444;
          --modal-loading-overlay: rgba(0, 0, 0, 0.7);
          --modal-spinner-color: #09f;
        }
        
        /* Light theme styles for the modal */
        .light-theme {
          --modal-bg-color: white;
          --modal-text-color: #333;
          --modal-border-color: #ddd;
          --modal-loading-overlay: rgba(255, 255, 255, 0.7);
          --modal-spinner-color: #09f;
        }
        
        .address-names-button {
          width: 50px;
          height: 50px;
          display: flex;
          justify-content: center;
          alignItems: 'center';
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px;
          cursor: pointer;
        }
        
        .address-names-button:disabled {
          background-color: #e0e0e0;
          cursor: not-allowed;
          opacity: 0.7;
        }
        
        .address-names-button:hover:not(:disabled) {
          background-color: #e0e0e0;
        }
        
        /* Dark theme address names button styles */
        .dark-theme .address-names-button {
          background-color: #444;
          border-color: #666;
        }
        
        /* Dark theme checkbox styles */
        .dark-theme input[type="checkbox"] {
          background-color: #444;
          border-color: #666;
        }
        
        .dark-theme .address-names-button:hover:not(:disabled) {
          background-color: #555;
        }
        
        .dark-theme .address-names-button span {
          color: #e0e0e0;
        }
        
        .arrow-button {
          width: 50px;
          height: 50px;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
        }
        
        .arrow-button:disabled {
          background-color: #e0e0e0;
          cursor: not-allowed;
          opacity: 0.7;
        }
        
        .arrow-button:hover:not(:disabled) {
          background-color: #e0e0e0;
        }
        
        .arrow-up::after {
          content: '';
          position: absolute;
          width: 0;
          height: 0;
          border-left: 15px solid transparent;
          border-right: 15px solid transparent;
          border-bottom: 20px solid #333;
        }
        
        .arrow-down::after {
          content: '';
          position: absolute;
          width: 0;
          height: 0;
          border-left: 15px solid transparent;
          border-right: 15px solid transparent;
          border-top: 20px solid #333;
        }
        
        .arrow-left::after {
          content: '';
          position: absolute;
          width: 0;
          height: 0;
          border-top: 15px solid transparent;
          border-bottom: 15px solid transparent;
          border-right: 20px solid #333;
        }
        
        .arrow-right::after {
          content: '';
          position: absolute;
          width: 0;
          height: 0;
          border-top: 15px solid transparent;
          border-bottom: 15px solid transparent;
          border-left: 20px solid #333;
        }
        
        /* Dark theme arrow styles */
        .dark-theme .arrow-button {
          background-color: #444;
          border-color: #666;
        }
        
        .dark-theme .arrow-button:hover:not(:disabled) {
          background-color: #555;
        }
        
        .dark-theme .arrow-up::after {
          border-bottom-color: #e0e0e0;
        }
        
        .dark-theme .arrow-down::after {
          border-top-color: #e0e0e0;
        }
        
        .dark-theme .arrow-left::after {
          border-right-color: #e0e0e0;
        }
        
        .dark-theme .arrow-right::after {
          border-left-color: #e0e0e0;
        }
        
        .zoom-button {
          width: 50px;
          height: 50px;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
        }
        
        .zoom-button:disabled {
          background-color: #e0e0e0;
          cursor: not-allowed;
          opacity: 0.7;
        }
        
        .zoom-button:hover:not(:disabled) {
          background-color: #e0e0e0;
        }
        
        /* Simple Plus Icon */
        .zoom-plus::before,
        .zoom-plus::after {
          content: '';
          position: absolute;
          background-color: #333;
        }
        
        .zoom-plus::before {
          width: 24px;
          height: 4px;
        }
        
        .zoom-plus::after {
          width: 4px;
          height: 24px;
        }
        
        /* Simple Minus Icon */
        .zoom-minus::before {
          content: '';
          position: absolute;
          width: 24px;
          height: 4px;
          background-color: #333;
        }
        
        /* Dark theme zoom button styles */
        .dark-theme .zoom-button {
          background-color: #444;
          border-color: #666;
        }
        
        .dark-theme .zoom-button:hover:not(:disabled) {
          background-color: #555;
        }
        
        .dark-theme .zoom-plus::before,
        .dark-theme .zoom-plus::after,
        .dark-theme .zoom-minus::before {
          background-color: #e0e0e0;
        }
        
        .home-button {
          width: 50px;
          height: 50px;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
        }
        
        .home-button:disabled {
          background-color: #e0e0e0;
          cursor: not-allowed;
          opacity: 0.7;
        }
        
        .home-button:hover:not(:disabled) {
          background-color: #e0e0e0;
        }
        
        /* Home Icon */
        .home-icon::before {
          content: '';
          position: absolute;
          width: 24px;
          height: 20px;
          background-color: #333;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          clip-path: polygon(
            50% 0%, 
            100% 40%, 
            100% 100%, 
            75% 100%, 
            75% 60%, 
            50% 60%, 
            25% 60%, 
            25% 100%, 
            0% 100%, 
            0% 40%
          );
        }
        
        /* Dark theme home button styles */
        .dark-theme .home-button {
          background-color: #444;
          border-color: #666;
        }
        
        .dark-theme .home-button:hover:not(:disabled) {
          background-color: #555;
        }
        
        .dark-theme .home-icon::before {
          background-color: #e0e0e0;
        }
        
        .edit-button {
          width: 50px;
          height: 50px;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          color: #333;
          padding: 0;
        }
        
        .edit-button:disabled {
          background-color: #e0e0e0;
          cursor: not-allowed;
          opacity: 0.7;
        }
        
        .edit-button:hover:not(:disabled) {
          background-color: #e0e0e0;
        }
        
        /* Dark theme edit button styles */
        .dark-theme .edit-button {
          background-color: #444;
          border-color: #666;
          color: #e0e0e0;
        }
        
        .dark-theme .edit-button:hover:not(:disabled) {
          background-color: #555;
        }
        
        .search-button {
          width: 50px;
          height: 50px;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
        }
        
        .search-button:disabled {
          background-color: #e0e0e0;
          cursor: not-allowed;
          opacity: 0.7;
        }
        
        .search-button:hover:not(:disabled) {
          background-color: #e0e0e0;
        }
        
        /* Search Icon */
        .search-icon::before {
          content: '';
          position: absolute;
          width: 20px;
          height: 20px;
          border: 3px solid #333;
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }
        
        .search-icon::after {
          content: '';
          position: absolute;
          width: 8px;
          height: 3px;
          background-color: #333;
          top: 65%;
          left: 65%;
          transform: translate(-50%, -50%) rotate(45deg);
        }
        
        /* Dark theme search button styles */
        .dark-theme .search-button {
          background-color: #444;
          border-color: #666;
        }
        
        .dark-theme .search-button:hover:not(:disabled) {
          background-color: #555;
        }
        
        .dark-theme .search-icon::before,
        .dark-theme .search-icon::after {
          background-color: #e0e0e0;
          border-color: #e0e0e0;
        }
        
        .index-button {
          width: 50px;
          height: 50px;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
        }
        
        .index-button:disabled {
          background-color: #e0e0e0;
          cursor: not-allowed;
          opacity: 0.7;
        }
        
        .index-button:hover:not(:disabled) {
          background-color: #e0e0e0;
        }
        
        /* Index Icon */
        .index-icon::before {
          content: 'I';
          position: absolute;
          font-size: 24px;
          font-weight: bold;
          color: #333;
        }
        
        /* Dark theme index button styles */
        .dark-theme .index-button {
          background-color: #444;
          border-color: #666;
        }
        
        .dark-theme .index-button:hover:not(:disabled) {
          background-color: #555;
        }
        
        .dark-theme .index-icon::before {
          color: #e0e0e0;
        }
        
        @keyframes indeterminateProgress {
          0% {
            left: -30%;
            width: 30%;
          }
          50% {
            left: 100%;
            width: 30%;
          }
          100% {
            left: 100%;
            width: 0%;
          }
        }
      `}</style>
    </div>
  );
}

export default App;
