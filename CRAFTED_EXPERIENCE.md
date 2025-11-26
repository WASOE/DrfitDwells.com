# ✨ Crafted Experience Wizard

## Overview
The Crafted Experience Wizard is a multi-step booking flow that allows guests to personalize their eco-retreat experience at Drift & Dwells. This immersive journey helps us understand what brings each guest to our cabins and tailor their stay accordingly.

## 🎯 Step 1: Trip Type Selection

**Route:** `/craft/step1`

**Purpose:** Understand the guest's motivation and intention for their stay.

### Features:
- **Visual Card Selection**: 8 beautifully designed trip type cards
- **Interactive UI**: Hover effects, selection states, and smooth transitions
- **Custom Input**: "Other" option with free text field
- **Progress Indicator**: Visual step counter (1 of 4)
- **Responsive Design**: Works on all device sizes

### Trip Types Available:
1. **Romantic Getaway** 💕 - Intimate moments in nature
2. **Family Retreat** 👨‍👩‍👧‍👦 - Quality time with loved ones
3. **Solo Reset** 🧘‍♀️ - Personal reflection and renewal
4. **Digital Detox** 📱 - Unplug and reconnect with nature
5. **Creative Escape** 🎨 - Inspiration in natural surroundings
6. **Nature Exploration** 🌲 - Adventure and discovery
7. **Adventure Weekend** ⛰️ - Thrills and outdoor activities
8. **Other** ✨ - Something unique to you

## 🛠️ Technical Implementation

### State Management
- **BookingContext**: Global React context for wizard state
- **useReducer**: Manages complex booking state with actions
- **Persistent State**: Maintains data across wizard steps

### Key Components
- `BookingContext.jsx` - Global state management
- `Step1TripType.jsx` - Trip type selection interface
- Updated `CabinDetails.jsx` - Integration point for wizard

### Integration Points
- **Entry Point**: "Start Crafted Experience" button in cabin details
- **State Persistence**: Booking info saved to context
- **Navigation**: Seamless flow between wizard steps

## 🎨 Design System

### Colors
- **Primary**: Drift Green (#2D5A27)
- **Secondary**: Drift Light Green (#4A7C59)
- **Accent Colors**: Each trip type has its own color palette

### Typography
- **Font**: Inter (Google Fonts)
- **Hierarchy**: Clear heading structure with proper spacing

### Interactions
- **Hover Effects**: Scale and shadow transitions
- **Selection States**: Visual feedback with checkmarks
- **Smooth Transitions**: 300ms duration for all animations

## 🚀 Usage Flow

1. **Guest selects cabin and dates** (existing flow)
2. **Clicks "Start Crafted Experience"** (new integration)
3. **Step 1**: Selects trip type with visual cards
4. **Step 2**: Arrival method selection ✅ **COMPLETED**
5. **Step 3**: Guest details collection (coming next)
6. **Step 4**: Final booking confirmation

## 📱 Responsive Design

- **Mobile**: Single column layout with touch-friendly cards
- **Tablet**: 2-column grid for optimal space usage
- **Desktop**: 4-column grid for maximum visual impact

## 🎯 Step 2: Arrival Method Selection

**Route:** `/craft/step2`

**Purpose:** Let guests choose how they want to arrive at their eco-retreat.

### Features:
- **Dynamic Transport Options**: Fetched from cabin's backend data
- **Visual Transport Cards**: Each with unique icons and color schemes
- **Cost Calculation**: Real-time pricing based on guest count
- **Responsive Design**: Works on all device sizes
- **Progress Tracking**: Visual step indicator

### Transport Types Available:
- 🐎 **Horse** - Traditional horse ride through trails
- 🚙 **ATV** - Adventure ride on all-terrain vehicle  
- 🛻 **Jeep** - Comfortable 4x4 transport
- 🥾 **Hike** - Scenic hiking trail (free option)
- 🚤 **Boat** - Scenic boat ride (lakeside cabins)
- 🚁 **Helicopter** - Luxury aerial transport

### Technical Implementation:
- **API Integration**: Fetches transport options from `/api/cabins/:id`
- **State Management**: Saves selected transport in BookingContext
- **Cost Calculation**: Shows estimated total cost per guest count
- **Validation**: Ensures transport selection before proceeding

## 🔮 Future Enhancements

- **Step 3**: Guest details collection
- **Step 4**: Final booking confirmation
- **Analytics**: Track popular trip types and transport methods
- **Personalization**: Use trip type for transport recommendations
- **Admin Panel**: Manage transport options and pricing

## 🧪 Testing

To test the wizard:
1. Navigate to any cabin details page
2. Click "Start Crafted Experience"
3. Select a trip type
4. Verify state persistence
5. Test "Other" option with custom input
6. Check responsive behavior

---

*Built with ❤️ for Drift & Dwells eco-retreat experience*
