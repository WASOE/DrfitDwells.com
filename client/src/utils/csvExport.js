// CSV export utility - no external dependencies
export const exportToCSV = (data, filename = 'bookings.csv') => {
  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  // Define headers
  const headers = [
    'Created',
    'Check-in',
    'Check-out',
    'Cabin',
    'Guest',
    'Guests (A/C)',
    'Trip Type',
    'Transport',
    'Total',
    'Status',
    'Booking Ref',
    'Booking ID'
  ];

  // Helper function to escape CSV values
  const escapeCSV = (value) => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    // If value contains comma, newline, or quote, wrap in quotes and escape quotes
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-GB');
  };

  // Helper function to format currency
  const formatCurrency = (amount) => {
    if (typeof amount !== 'number') return '';
    return new Intl.NumberFormat(undefined, { 
      maximumFractionDigits: 2 
    }).format(amount);
  };

  // Helper function to format guest name
  const formatGuestName = (guestInfo) => {
    if (!guestInfo) return '';
    if (guestInfo.firstName && guestInfo.lastName) {
      return `${guestInfo.firstName} ${guestInfo.lastName}`;
    }
    return guestInfo.firstName || guestInfo.lastName || '';
  };

  // Helper function to format guests count
  const formatGuests = (adults, children) => {
    return `${adults}A${children > 0 ? ` ${children}C` : ''}`;
  };

  // Helper function to get transport type
  const getTransportType = (transportMethod) => {
    if (!transportMethod) return '—';
    if (typeof transportMethod === 'string') return transportMethod;
    if (transportMethod.type) return transportMethod.type;
    return '—';
  };

  // Convert data to CSV rows
  const csvRows = data.map(booking => [
    escapeCSV(formatDate(booking.createdAt)),
    escapeCSV(formatDate(booking.checkIn)),
    escapeCSV(formatDate(booking.checkOut)),
    escapeCSV(booking.cabinName || ''),
    escapeCSV(formatGuestName(booking.guestInfo)),
    escapeCSV(formatGuests(booking.adults, booking.children)),
    escapeCSV(booking.tripType || ''),
    escapeCSV(getTransportType(booking.transportMethod)),
    escapeCSV(formatCurrency(booking.totalPrice)),
    escapeCSV(booking.status || ''),
    escapeCSV(booking._id),
    escapeCSV(booking._id)
  ]);

  // Combine headers and data
  const csvContent = [headers.join(','), ...csvRows.map(row => row.join(','))].join('\n');

  // Create and download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};

