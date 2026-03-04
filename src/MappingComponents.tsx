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

interface NameListItemProps {
  name: string;
  index: number;
  draggable: boolean;
  onDragStart: (e: React.DragEvent, item: string) => void;
  onRemove: (name: string) => void;
  isSelected: boolean;
}

interface NamesListProps {
  names: string[];
  draggable?: boolean;
  onDragStart: (e: React.DragEvent, item: string) => void;
  onRemove: (name: string) => void;
  isSelected?: boolean;
  height?: string;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  emptyMessage: string;
  loading?: boolean;
}

interface ImageTileProps {
  image: string | null;
  index: number;
  loading: boolean;
  zoom: number;
  x: number;
  y: number;
  onTileClick: (event: React.MouseEvent<HTMLDivElement>, identifier: string) => void;
}

interface ImageGridProps {
  images: Array<string | null>;
  imageLoading: boolean[];
  zoom: number;
  x: number;
  y: number;
  onTileClick: (event: React.MouseEvent<HTMLDivElement>, identifier: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Formats latitude with N/S suffix and rounded to nearest integer.
 */
function formatLat(lat: number): string {
  const rounded = Math.round(lat);
  if (rounded >= 0) return `${rounded}N`;
  return `${Math.abs(rounded)}S`;
}

/**
 * Formats longitude with E/W suffix and rounded to nearest integer.
 */
function formatLng(lng: number): string {
  const rounded = Math.round(lng);
  if (rounded >= 0) return `${rounded}E`;
  return `${Math.abs(rounded)}W`;
}

// SearchResultItem component
const SearchResultItem = ({ result, onLinkClick }: SearchResultItemProps) => {
  const scoreValue = typeof result.score === 'number' ? Math.round(result.score * 100) : 0;
  // We need a basic parse for the display string
  let displayCoords = '';
  if (result.link && typeof result.link === 'string') {
    const parts = result.link.split('-');
    if (parts.length >= 3) {
      let lat: number | null = null;
      let lng: number | null = null;
      let negateNext = false;
      for (let i = 1; i < parts.length; i++) {
        if (parts[i] === '') {
          negateNext = true;
          continue;
        }
        const val = parseFloat(parts[i]);
        if (!isNaN(val)) {
          const num = negateNext ? -val : val;
          negateNext = false;
          if (lat === null) lat = num;
          else if (lng === null) {
            lng = num;
            break;
          }
        }
      }
      if (lat !== null && lng !== null) {
        displayCoords = `${formatLat(lat)}, ${formatLng(lng)}`;
      }
    }
  }

  return (
    <div style={{
      marginBottom: '3px',
      paddingBottom: '3px',
      borderBottom: '1px solid #eee',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch'
    }}>
      <div style={{ flex: 1 }}>
        {result.link ? (
          <button
            onClick={() => onLinkClick(result.link, result.name)}
            style={{
              width: '100%',
              padding: '8px 16px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              marginTop: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
            title={`Go to location: ${result.link}`}
          >
            <div style={{ flex: 1, textAlign: 'left' }}>
              {displayCoords}
            </div>
            <span
              style={{
                flex: 1,
                textAlign: 'right',
                backgroundColor: 'rgba(0,0,0,0.2)',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '14px',
                marginLeft: '8px',
              }}
            >
              Score: {scoreValue}%
            </span>
          </button>
        ) : (
          <span style={{ color: '#999', fontStyle: 'italic', fontSize: '11px' }}>No link</span>
        )}
      </div>
    </div>
  );
};

// SearchResultsList component
const SearchResultsList = ({ searchResults, onLinkClick }: SearchResultsListProps) => {
  if (searchResults.length === 0) return null;
  
  return (
    <div style={{
      marginTop: '10px',
      padding: '10px',
      backgroundColor: 'white',
      color: '#333',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '14px'
    }}>
      <div style={{
        maxHeight: '150px',
        overflowY: 'auto',
        padding: '5px'
      }}>
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

// NameListItem component
const NameListItem = ({ name, index, draggable, onDragStart, onRemove, isSelected }: NameListItemProps) => {
  return (
    <div
      key={index}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart(e, name) : undefined}
      style={{
        padding: '5px',
        margin: '2px 0',
        border: isSelected ? '1px solid #4caf50' : '1px solid #ddd',
        borderRadius: '3px',
        cursor: 'move',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}
    >
      <span>{name}</span>
      {isSelected && (
        <button
          onClick={() => onRemove(name)}
          style={{
            marginLeft: '10px',
            padding: '2px 8px',
            backgroundColor: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
};

// NamesList component
const NamesList = ({ 
  names, 
  draggable = true, 
  onDragStart, 
  onRemove,
  isSelected = false,
  height = '200px',
  onDragOver,
  onDrop,
  emptyMessage,
  loading = false
}: NamesListProps) => {
  return (
    <div
      style={{
        height: height,
        overflowY: 'auto',
        border: '1px solid #ccc',
        padding: '10px',
        borderRadius: '4px'
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div className="spinner"></div>
          <div style={{ marginTop: '10px' }}>Searching...</div>
        </div>
      ) : names.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          {emptyMessage}
        </div>
      ) : (
        names.map((name, index) => (
          <NameListItem
            key={index}
            name={name}
            index={index}
            draggable={draggable}
            onDragStart={onDragStart}
            onRemove={onRemove}
            isSelected={isSelected}
          />
        ))
      )}
    </div>
  );
};

// ImageTile component
const ImageTile = ({ 
  image, 
  index, 
  loading, 
  zoom, 
  x, 
  y, 
  onTileClick 
}: ImageTileProps) => {
  return (
    <div
      key={index}
      style={{ 
        width: '256px', 
        height: '256px', 
        backgroundColor: 'transparent', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        fontSize: '24px', 
        textAlign: 'center', 
        position: 'relative' 
      }}
      onClick={(event) => onTileClick(event, `${zoom}-${x + (index % 2)}-${y + Math.floor(index / 2)}`)}
    >
      {loading ? (
        <div className="spinner"></div>
      ) : (
        <>
          {typeof image === 'string' && image.startsWith('data:image/png;base64,') ? (
            <img src={image} alt={`Tile ${index}`} style={{ width: '100%', height: '100%' }} />
          ) : (
            <div style={{ whiteSpace: 'pre' }}>{image}</div>
          )}
        </>
      )}
    </div>
  );
};

// ImageGrid component
const ImageGrid = ({ 
  images, 
  imageLoading, 
  zoom, 
  x, 
  y, 
  onTileClick,
  containerRef
}: ImageGridProps) => {
  return (
    <div ref={containerRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 256px)', gridTemplateRows: 'repeat(2, 256px)', gap: '0', position: 'relative' }}>
      {images.map((image, index) => (
        <ImageTile
          key={index}
          image={image}
          index={index}
          loading={imageLoading[index]}
          zoom={zoom}
          x={x}
          y={y}
          onTileClick={onTileClick}
        />
      ))}
    </div>
  );
};

// Export all components
export {
  SearchResultItem,
  SearchResultsList,
  NameListItem,
  NamesList,
  ImageTile,
  ImageGrid
};