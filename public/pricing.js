document.addEventListener('DOMContentLoaded', () => {
    // 1. Get Address from URL
    const params = new URLSearchParams(window.location.search);
    let address = params.get('address');
    
    // 2. Display Address
    const addressDisplay = document.getElementById('display-address');
    if (address && addressDisplay) {
        addressDisplay.textContent = address;
    } else {
        if(addressDisplay) addressDisplay.textContent = "Your Location";
    }

    // 3. Bind Sign-Up Button Events
    document.querySelectorAll('.sign-up-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const planBox = e.target.closest('.pricing-box');
            const plan = planBox.dataset.plan;
            
            // If address wasn't in URL, try to grab it from display (fallback)
            if (!address && addressDisplay) {
                address = addressDisplay.textContent !== "Your Location" ? addressDisplay.textContent : "";
            }

            handleSignUp(plan, address);
        });
    });

    // 4. Bind Broadband Facts Toggle (Sneak Peek Style)
    document.querySelectorAll('.expand-label-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            // Find the wrapper (parent of the overlay that contains this button)
            const overlay = e.target.closest('.sneak-peek-overlay');
            const wrapper = overlay.parentElement;

            if (wrapper) {
                wrapper.classList.remove('collapsed');
                wrapper.classList.add('expanded');
                // The overlay is hidden by CSS when .expanded is present
            }
        });
    });
});

function handleSignUp(plan, address) {
    // Construct the URL with query parameters
    let url = `signup.html?plan=${encodeURIComponent(plan)}`;
    
    // Only append address if it exists and isn't the placeholder
    if (address && address !== "Unspecified Address" && address !== "Your Location") {
        url += `&address=${encodeURIComponent(address)}`;
    }
    
    // Redirect to the signup page
    window.location.href = url;
}