document.addEventListener('DOMContentLoaded', () => {
    // 1. Get Address from URL
    const params = new URLSearchParams(window.location.search);
    const address = params.get('address');
    
    // 2. Display Address
    const addressDisplay = document.getElementById('display-address');
    if (address && addressDisplay) {
        addressDisplay.textContent = address;
    } else {
        addressDisplay.textContent = "Your Location";
    }

    // 3. Bind Sign-Up Button Events
    document.querySelectorAll('.sign-up-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const planBox = e.target.closest('.pricing-box');
            const plan = planBox.dataset.plan;
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
    if (!address) {
        address = "Unspecified Address";
    }
    
    const url = `signup.html?plan=${encodeURIComponent(plan)}&address=${encodeURIComponent(address)}`;
    console.log(`Navigating to: ${url}`);
    
    alert(`Great choice! You selected the ${plan} plan for ${address}. \n\n(This would normally take you to the final checkout page)`);
}