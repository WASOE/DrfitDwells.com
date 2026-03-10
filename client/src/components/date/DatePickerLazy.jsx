import DatePicker from 'react-datepicker';
// CSS is loaded in SearchBar.loadDatePicker so it stays off the initial route

// Thin wrapper so we can lazy-load react-datepicker (CSS loaded on interaction)
const DatePickerLazy = (props) => {
  return <DatePicker {...props} />;
};

export default DatePickerLazy;

