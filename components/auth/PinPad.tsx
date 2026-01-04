"use client";

interface PinPadProps {
  pin: string;
  onPinChange: (pin: string) => void;
  onSubmit: () => void;
  maxLength?: number;
  hideSubmit?: boolean;
  disabled?: boolean;
}

export default function PinPad({
  pin,
  onPinChange,
  onSubmit,
  maxLength = 4,
  hideSubmit = false,
  disabled = false,
}: PinPadProps) {
  const handleNumberClick = (num: string) => {
    if (disabled) return;
    if (pin.length < maxLength) {
      onPinChange(pin + num);
    }
  };

  const handleBackspace = () => {
    if (disabled) return;
    onPinChange(pin.slice(0, -1));
  };

  const handleClear = () => {
    if (disabled) return;
    onPinChange("");
  };

  const handleSubmitClick = () => {
    if (pin.length === maxLength && !disabled) {
      onSubmit();
    }
  };

  const buttons = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["clear", "0", "backspace"],
  ];

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* PIN Display - 4 circles */}
      <div className="mb-8 flex justify-center gap-4">
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            className={`w-14 h-14 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
              i < pin.length
                ? "border-accent-blue bg-accent-blue/10"
                : "border-border bg-bg-tertiary"
            }`}
          >
            {i < pin.length && (
              <div className="w-3 h-3 rounded-full bg-accent-blue" />
            )}
          </div>
        ))}
      </div>

      {/* Number Pad */}
      <div className="grid grid-cols-3 gap-3">
        {buttons.map((row, rowIndex) =>
          row.map((btn, colIndex) => {
            if (btn === "clear") {
              return (
                <button
                  key={`${rowIndex}-${colIndex}`}
                  onClick={handleClear}
                  disabled={disabled || pin.length === 0}
                  className="h-16 rounded-lg font-medium text-sm uppercase tracking-wider transition-all duration-150 active:scale-95 border border-border bg-bg-tertiary text-text-secondary hover:border-accent-blue/50 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              );
            }

            if (btn === "backspace") {
              return (
                <button
                  key={`${rowIndex}-${colIndex}`}
                  onClick={handleBackspace}
                  disabled={disabled || pin.length === 0}
                  className="h-16 rounded-lg font-medium text-sm uppercase tracking-wider transition-all duration-150 active:scale-95 border border-border bg-bg-tertiary text-text-secondary hover:border-accent-blue/50 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Del
                </button>
              );
            }

            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                onClick={() => handleNumberClick(btn)}
                disabled={disabled}
                className="h-16 rounded-lg font-light text-2xl transition-all duration-150 active:scale-95 border border-border bg-bg-secondary text-text-primary hover:bg-bg-tertiary hover:border-accent-blue/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {btn}
              </button>
            );
          })
        )}
      </div>

      {/* Submit Button - Only show if not auto-submitting */}
      {!hideSubmit && (
        <button
          onClick={handleSubmitClick}
          disabled={pin.length !== maxLength || disabled}
          className={`w-full h-14 mt-6 rounded-lg font-medium text-sm uppercase tracking-widest transition-all duration-200 active:scale-[0.98] border disabled:opacity-40 disabled:cursor-not-allowed ${
            pin.length === maxLength && !disabled
              ? "bg-accent-blue border-accent-blue text-white hover:opacity-90"
              : "bg-bg-tertiary border-border text-text-tertiary"
          }`}
        >
          {pin.length === maxLength ? "Enter" : "Enter PIN"}
        </button>
      )}
    </div>
  );
}
