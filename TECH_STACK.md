# Drift & Dwells Booking Portal - Complete Tech Stack Overview

## Project Overview
**Repository:** `git@github.com:WASOE/DrfitDwells.com.git`  
**Type:** Full-stack MERN application (MongoDB, Express, React, Node.js)  
**Architecture:** Monorepo with separate client and server directories

---

## Project Structure

```
drift-dwells-booking-portal/
├── client/                 # React frontend application
│   ├── src/
│   │   ├── pages/         # Page components (Home, About, Build, TheCabin, TheValley, etc.)
│   │   ├── components/    # Reusable components
│   │   ├── context/      # React Context providers
│   │   ├── layouts/      # Layout components
│   │   ├── data/         # Static data and content
│   │   └── utils/        # Utility functions
│   ├── public/           # Static assets (audio, images)
│   └── dist/             # Production build output
├── server/                # Express.js backend API
│   ├── routes/           # API route handlers
│   ├── models/           # Mongoose models
│   ├── controllers/     # Business logic controllers
│   ├── middleware/       # Express middleware
│   ├── services/         # Service layer (email, assignment engine)
│   ├── scripts/          # Utility scripts (seed, generate reviews, etc.)
│   └── config/           # Configuration files
├── uploads/              # User-uploaded files (images, PDFs)
└── wordpress-plugin/      # WordPress integration plugin

```

---

## Frontend Stack

### Core Framework
- **React 18.2.0** - UI library
- **React Router DOM 6.20.1** - Client-side routing
- **Vite 5.0.0** - Build tool and dev server

### UI Libraries & Animation
- **Framer Motion 12.23.24** - Animation library
- **Lucide React 0.554.0** - Icon library
- **React Icons 5.5.0** - Additional icons

### Styling
- **Tailwind CSS 3.3.6** - Utility-first CSS framework
- **PostCSS 8.4.32** - CSS processing
- **Autoprefixer 10.4.16** - CSS vendor prefixing
- **Custom CSS** - Design system in `the-valley.css`

### Date Handling
- **React DatePicker 4.25.0** - Date selection component
- **React Day Picker 9.11.2** - Calendar component
- **date-fns 2.30.0** - Date utility library

### PDF Generation
- **jsPDF 2.5.1** - PDF generation (lazy loaded)

### HTTP Client
- **Axios 1.6.2** - HTTP requests

### Development Tools
- **ESLint 8.53.0** - Code linting
- **@vitejs/plugin-react 4.1.1** - Vite React plugin
- **TypeScript types** - Type definitions for React

### Key Frontend Features
- **Responsive Design** - Mobile-first approach with desktop constraints
- **Image Optimization** - WebP conversion, responsive images
- **Lazy Loading** - Components and images
- **Audio Player** - Background audio for different routes
- **Booking System** - Modal-based booking interface
- **Configurator** - Interactive cabin builder (Build page)
- **Archive Gallery** - Polaroid-style image galleries

---

## Backend Stack

### Core Framework
- **Node.js** - Runtime environment
- **Express 4.18.2** - Web framework
- **MongoDB** - Database (via Mongoose)

### Database
- **Mongoose 8.0.3** - MongoDB ODM
- **Database Name:** `drift-dwells-booking` (default)
- **Connection:** MongoDB URI from environment variable

### Middleware & Utilities
- **CORS 2.8.5** - Cross-origin resource sharing
- **Compression 1.8.1** - Response compression
- **Multer 2.0.2** - File upload handling
- **Express Validator 7.0.1** - Request validation
- **dotenv 16.3.1** - Environment variable management
- **Moment 2.29.4** - Date manipulation

### Email Service
- **Nodemailer 7.0.6** - Email sending

### File Handling
- **adm-zip 0.5.16** - ZIP file creation/extraction
- **form-data 4.0.4** - Form data handling

### Development Tools
- **Nodemon 3.0.2** - Auto-restart on file changes

### API Routes
- `/api/availability` - Check cabin availability
- `/api/bookings` - Create and manage bookings
- `/api/cabins` - Cabin information
- `/api/cabin-types` - Cabin type information
- `/api/units` - Unit management
- `/api/reviews` - Review management
- `/api/admin/*` - Admin routes (protected)
- `/api/drafts` - Draft booking management
- `/api/email-webhook` - Email event webhooks

### Data Models
- **Booking** - Guest bookings
- **Cabin** - Individual cabin entities
- **CabinType** - Cabin type definitions (e.g., "A-frame", "Lux Cabin")
- **Unit** - Specific units within cabin types
- **Review** - Guest reviews
- **Draft** - Draft bookings
- **EmailEvent** - Email tracking events

---

## Build & Development Tools

### Root Level
- **Concurrently 8.2.2** - Run multiple npm scripts simultaneously
- **ffmpeg-static 5.3.0** - Video processing (static binary)
- **Sharp 0.34.5** - Image processing and optimization

### Build Process
- **Frontend Build:** `cd client && npm run build` → Outputs to `client/dist/`
- **Production Server:** Serves static files from `client/dist/` + API routes

---

## Environment Variables Required

### Server (.env in root or server directory)
```bash
# Database
MONGODB_URI=mongodb://localhost:27017/drift-dwells-booking
# OR for production:
# MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/drift-dwells-booking

# Server
PORT=5000
NODE_ENV=production  # or 'development'

# Email Configuration (if using email service)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your-email@example.com
EMAIL_PASS=your-password
EMAIL_FROM=noreply@driftdwells.com

# Admin Authentication (if using admin routes)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=secure-password
ADMIN_SECRET=your-secret-key

# Feature Flags (optional)
ENABLE_FEATURE_X=true
```

### Client
- No environment variables required (uses Vite proxy for API calls)
- Development: Proxies `/api` and `/uploads` to `http://localhost:5000`

---

## Installation & Setup

### Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)
- **MongoDB** (local installation OR MongoDB Atlas connection string)

### Step-by-Step Installation

```bash
# 1. Clone repository
git clone git@github.com:WASOE/DrfitDwells.com.git
cd DrfitDwells.com

# 2. Install root dependencies
npm install

# 3. Install client dependencies
cd client
npm install
cd ..

# 4. Install server dependencies
cd server
npm install
cd ..

# 5. Create environment file
# In root directory, create .env file:
cat > .env << EOF
MONGODB_URI=mongodb://localhost:27017/drift-dwells-booking
PORT=5000
NODE_ENV=development
EOF

# 6. Start MongoDB (if running locally)
# On Linux/Mac:
sudo systemctl start mongod
# OR
mongod

# 7. Seed database (optional - if you have seed scripts)
cd server
npm run seed

# 8. Start development servers
# From root directory:
npm run dev
# This runs both client (port 3000) and server (port 5000) concurrently

# OR start separately:
# Terminal 1 - Server:
npm run server

# Terminal 2 - Client:
npm run client
```

---

## Production Deployment

### Build Process

```bash
# 1. Build frontend
cd client
npm run build
# Output: client/dist/

# 2. Start production server
cd ../server
npm start
# Server will serve static files from ../client/dist/ and handle API routes
```

### Server Configuration (Production)

The Express server is configured to:
1. Serve static files from `client/dist/` in production
2. Handle API routes at `/api/*`
3. Serve uploaded files from `/uploads/*`
4. Fallback to `index.html` for client-side routing (SPA)

### Ports
- **Development:**
  - Client: `http://localhost:3000`
  - Server: `http://localhost:5000`
- **Production:**
  - Single port (default: 5000) - serves both frontend and API

---

## Key Features & Pages

### Frontend Pages
- `/` - Home page
- `/about` - Story/About page with archive gallery
- `/cabin` - The Cabin page
- `/the-valley` - The Valley page
- `/build` - Cabin configurator/builder
- `/search` - Search results
- `/cabin/:id` - Individual cabin details
- `/booking-success/:id` - Booking confirmation
- Legal pages: `/terms`, `/privacy`, `/cancellation-policy`

### Special Components
- **BookingDrawer** - Booking modal/interface
- **Configurator** - Interactive cabin builder (Build page)
- **ArchiveGallery** - Polaroid-style image galleries
- **AudioPlayer** - Background audio per route
- **AnnouncementBar** - Top announcement banner
- **Header** - Navigation with transparent/solid states
- **Footer** - Newsletter signup and links

---

## File Upload System

- **Upload Directory:** `/uploads/` (root level)
- **Cabin Images:** `/uploads/cabins/[cabinId]/`
- **Static Assets:** `/uploads/The Cabin/`, `/uploads/The Valley/`, etc.
- **Handling:** Multer middleware for file uploads
- **Served:** Static files served at `/uploads/*` route

---

## Database Schema Overview

### Booking Model
- Guest information (name, email, phone)
- Dates (checkIn, checkOut)
- Cabin/Unit assignment
- Status (pending, confirmed, cancelled)
- Special requests

### Cabin Model
- Name, description
- Location, amenities
- Images, pricing
- Availability rules

### CabinType Model
- Type name (e.g., "A-frame", "Lux Cabin")
- Multiple units
- Shared amenities
- Pricing structure

### Review Model
- Guest reviews
- Ratings
- External IDs (Airbnb, Booking.com)
- Host responses

---

## Development Scripts

### Root Level
```bash
npm run dev      # Run client + server concurrently
npm run server   # Run server only
npm run client   # Run client only
npm run build    # Build client for production
npm start        # Start production server
```

### Client
```bash
npm run dev      # Start Vite dev server (port 3000)
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

### Server
```bash
npm start        # Start production server
npm run dev      # Start with nodemon (auto-restart)
npm run seed      # Seed database
```

---

## Important Notes for Deployment

1. **MongoDB Connection:** Ensure MongoDB is accessible (local or cloud)
2. **Environment Variables:** Create `.env` file with required variables
3. **File Permissions:** Ensure `uploads/` directory is writable
4. **Static Files:** Production server serves `client/dist/` as static files
5. **CORS:** Configured for cross-origin requests
6. **Image Optimization:** Uses Sharp for image processing (server-side)
7. **PDF Generation:** jsPDF is lazy-loaded in client
8. **Audio Files:** Stored in `client/public/audio/`

---

## Dependencies Summary

### Total Files Tracked: 714 files
### Key Technologies:
- **Frontend:** React 18, Vite, Tailwind CSS, Framer Motion
- **Backend:** Node.js, Express, Mongoose
- **Database:** MongoDB
- **Build:** Vite (frontend), Node.js (backend)
- **Styling:** Tailwind CSS + Custom CSS
- **Icons:** Lucide React, React Icons
- **Date Handling:** React DatePicker, date-fns
- **PDF:** jsPDF
- **HTTP:** Axios
- **File Upload:** Multer
- **Email:** Nodemailer
- **Image Processing:** Sharp

---

## Deployment Checklist

- [ ] Install Node.js (v18+)
- [ ] Install MongoDB or configure MongoDB Atlas
- [ ] Clone repository
- [ ] Install dependencies (root, client, server)
- [ ] Create `.env` file with required variables
- [ ] Seed database (if needed)
- [ ] Build frontend: `cd client && npm run build`
- [ ] Start server: `cd server && npm start`
- [ ] Verify API endpoints are accessible
- [ ] Verify static files are served correctly
- [ ] Test booking flow
- [ ] Configure reverse proxy (nginx/Apache) if needed
- [ ] Set up SSL/HTTPS
- [ ] Configure domain and DNS

---

This is a complete MERN stack application ready for deployment. The server serves both the API and the built React frontend in production.
