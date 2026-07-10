// Extract total from URL query parameters (default to R50.00 if missing or invalid)
const urlParams = new URLSearchParams(window.location.search);
const totalParam = parseFloat(urlParams.get('total'));
const MOCK_TOTAL_RANDS = (!isNaN(totalParam) && totalParam > 0) ? totalParam : 50.00;

// Update the HTML display with the dynamic total immediately
const displayTotalEl = document.getElementById('displayTotal');
if (displayTotalEl) {
  displayTotalEl.textContent = `R ${MOCK_TOTAL_RANDS.toFixed(2)}`;
}

// Configure constants
const YOCO_PUBLIC_KEY = 'pk_test_ed3c54a6gXZdqdq1e44f';
const WEB3FORMS_ACCESS_KEY = 'c2410d9a-d9b7-4b55-819b-e7b041577b5b';

// Initialize Yoco SDK safely after window load event (ensuring SDK is fully downloaded)
let yoco = null;

function initializeYoco() {
  try {
    if (window.YocoSDK) {
      yoco = new window.YocoSDK({
        publicKey: YOCO_PUBLIC_KEY
      });
      console.log('Yoco SDK initialized successfully on load.');

      if (YOCO_PUBLIC_KEY.includes('YOUR_YOCO_SANDBOX_KEY')) {
        console.warn('Yoco public key is still using the placeholder value. Replace YOCO_PUBLIC_KEY in script.js with your actual sandbox key.');
      }
      return true;
    }

    console.warn('Yoco SDK not detected in window on load.');
    return false;
  } catch (e) {
    console.error('Yoco SDK initialization failed on load:', e);
    return false;
  }
}

window.addEventListener('load', initializeYoco);

function startYocoPayment(paymentData) {
  return new Promise((resolve, reject) => {
    if (!yoco) {
      reject(new Error('Yoco SDK is not available yet. Please refresh the page.'));
      return;
    }

    if (typeof yoco.showPopup === 'function') {
      yoco.showPopup(paymentData, (result) => {
        if (result && (result.status === 'success' || result.id || result.token)) {
          resolve(result);
        } else if (result && result.status === 'cancelled') {
          reject(new Error('Payment was cancelled.'));
        } else {
          reject(new Error(result && result.message ? result.message : 'Payment failed.'));
        }
      });
      return;
    }

    if (typeof yoco.showPaymentModal === 'function') {
      yoco.showPaymentModal(paymentData)
        .then(resolve)
        .catch(reject);
      return;
    }

    reject(new Error('Yoco SDK does not expose a supported payment method.'));
  });
}

const form = document.getElementById('paymentForm');
const payBtn = document.getElementById('payBtn');
const statusMsg = document.getElementById('statusMessage');

// Form Submit Handler
form.addEventListener('submit', function (e) {
  e.preventDefault();

  // Clear previous status
  statusMsg.textContent = '';
  statusMsg.className = '';

  // Extract Form Data
  const fullName = document.getElementById('fullName').value.trim();
  const gradeClass = document.getElementById('gradeClass').value.trim();
  const email = document.getElementById('email').value.trim();

  // Build order item summary from the in-browser cart
  const cart = JSON.parse(sessionStorage.getItem('snoop_cart') || '{}');
  const menu = JSON.parse(sessionStorage.getItem('snoop_menu') || '[]');
  const orderItems = Object.entries(cart).map(([id, quantity]) => {
    const item = menu.find((m) => m.id === id) || { name: id, price: 0 };
    const itemTotal = ((item.price || 0) * quantity).toFixed(2);
    return `${quantity} x ${item.name || id} (R${itemTotal})`;
  });
  const orderSummary = orderItems.length > 0 ? orderItems.join('\n') : 'No order items found.';

  // Store in sessionStorage as requested
  const orderDetails = {
    fullName: fullName,
    gradeClass: gradeClass,
    email: email,
    amount: MOCK_TOTAL_RANDS,
    currency: 'ZAR',
    orderSummary: orderSummary
  };

  sessionStorage.setItem('pendingOrder', JSON.stringify(orderDetails));

  // Disable button and show loading state
  statusMsg.textContent = 'Initializing Yoco payment...';
  statusMsg.className = 'status-loading';
  payBtn.disabled = true;

  // Convert amount from Rands to cents (Yoco uses cents)
  const amountInCents = Math.round(MOCK_TOTAL_RANDS * 100);
  const paymentData = {
    amountInCents: amountInCents,
    amount: amountInCents,
    currency: 'ZAR',
    name: fullName,
    email: email,
    description: `Pre-order for ${gradeClass}`,
    metadata: {
      gradeClass: gradeClass,
      orderSummary: orderSummary
    }
  };

  // Request payment from Yoco
  startYocoPayment(paymentData)
    .then(result => {
      console.log('Yoco payment success:', result);
      const paymentToken = result.id || result.token || 'yoco_' + Date.now();
      submitOrderToWeb3Forms(paymentToken);
    })
    .catch(error => {
      console.error('Yoco payment cancelled or failed:', error);
      statusMsg.textContent = error.message || 'Payment cancelled or failed. Please try again.';
      statusMsg.className = 'status-error';
      payBtn.disabled = false;
    });
});

// Submit Data to Web3Forms
function submitOrderToWeb3Forms(paymentToken) {
  // Retrieve saved student data from sessionStorage
  const savedOrder = JSON.parse(sessionStorage.getItem('pendingOrder'));
  if (!savedOrder) {
    statusMsg.textContent = 'Error: Order data not found in session.';
    statusMsg.className = 'status-error';
    payBtn.disabled = false;
    return;
  }

  // Construct Web3Forms Submission Payload
  const payload = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: `Pre-order PAID: ${savedOrder.fullName}`,
    name: savedOrder.fullName,
    email: savedOrder.email,
    grade_class: savedOrder.gradeClass,
    amount: `R ${savedOrder.amount.toFixed(2)}`,
    items: savedOrder.orderSummary,
    status: 'PAID VIA YOCO (SANDBOX)',
    yoco_payment_token: paymentToken,
    message: `Payment successful. Student ${savedOrder.fullName} (${savedOrder.gradeClass}) has paid R ${savedOrder.amount.toFixed(2)} online via Yoco Sandbox.\n\nItems Ordered:\n${savedOrder.orderSummary}`
  };

  fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Web3Forms submission failed');
      }

      // Success workflow
      statusMsg.textContent = 'Success! Redirecting to confirmation page...';
      statusMsg.className = 'status-success';

      // Save order to local history
      try {
        const history = JSON.parse(localStorage.getItem('tuckshop_orders') || '[]');
        history.push({
          date: new Date().toISOString(),
          total: savedOrder.amount,
          items: savedOrder.orderSummary,
          token: paymentToken
        });
        localStorage.setItem('tuckshop_orders', JSON.stringify(history));
      } catch (e) {
        console.error("Error saving order to localStorage history:", e);
      }

      // Clear sessionStorage and redirect
      sessionStorage.removeItem('pendingOrder');
      setTimeout(() => {
        window.location.href = 'success.html';
      }, 1500);
    })
    .catch((error) => {
      console.error("Web3Forms Submission Error:", error);
      statusMsg.textContent = `Order saved locally, but email alert failed to send: ${error.message}`;
      statusMsg.className = 'status-error';
      payBtn.disabled = false;
    });
}
