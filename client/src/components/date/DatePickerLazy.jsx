import { forwardRef } from 'react';
import DatePicker from 'react-datepicker';
// CSS is loaded in SearchBar.loadDatePicker so it stays off the initial route

/**
 * readOnly + autocomplete off so the field acts as a picker trigger, not a free-text
 * field (avoids browser history / autofill overlays on top of the calendar).
 * react-datepicker forwards onClick/onKeyDown/onFocus, aria-* and id from the parent — keep {...rest}
 * after ref so SR/keyboard behavior matches the stock input.
 */
const DdDatePickerInput = forwardRef(function DdDatePickerInput({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      {...rest}
      type="text"
      readOnly
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      inputMode="none"
      data-lpignore="true"
      data-1p-ignore="true"
      data-form-type="other"
      className={className}
    />
  );
});

DdDatePickerInput.displayName = 'DdDatePickerInput';

const DatePickerLazy = ({ customInput, ...props }) => {
  return <DatePicker customInput={customInput ?? <DdDatePickerInput />} {...props} />;
};

export default DatePickerLazy;
