import React, { Component } from 'react';
import logo from './logo.svg';
import ArtQR from './qr/bundle.cjs.js';
import './App.css';

class App extends Component {
  componentDidMount() {
    this.renderQR()
  }

  renderQR = () => {
    new ArtQR().create({
      text: 'https://baidu.com',
      size: 200,
      margin: 20,
      colorDark: '#000000',
      colorLight: '#FFFFFF',
      backgroundImage: undefined,
      backgroundDimming: 'rgba(0,0,0,0)',
      logoImage: undefined,
      logoScale: 0.2,
      logoMargin: 0,
      logoCornerRadius: 8,
      whiteMargin: true,
      dotScale: 0.35,
      autoColor: true,
      binarize: false,
      binarizeThreshold: 128,
      callback: function(dataURI) {
        console.log(dataURI)
      },
      bindElement: 'qrcode'
    })
  }

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <h1 className="App-title">Welcome to React</h1>
        </header>
        <img src="" alt="qr" id="qrcode" />
      </div>
    );
  }
}

export default App;
