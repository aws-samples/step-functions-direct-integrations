/**
 * Copyright 2022 Amazon Web Services (AWS)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.

 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import React, { Component } from 'react';
import AdapterDateFns from '@mui/lab/AdapterDateFns';
import Alert from '@mui/material/Alert';
import frLocale from "date-fns/locale/fr";
import axios from 'axios';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import countryList from 'react-select-country-list';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import CssBaseline from '@mui/material/CssBaseline';
import DatePicker from '@mui/lab/DatePicker';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Dropzone from 'react-dropzone';
import FormControl from '@mui/material/FormControl';
import Grid from '@mui/material/Grid';
import HelpIcon from '@mui/icons-material/Help';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import Link from '@mui/material/Link';
import LocalizationProvider from '@mui/lab/LocalizationProvider';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import SendIcon from '@mui/icons-material/Send';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { w3cwebsocket as W3CWebSocket } from "websocket";
import { createTheme, ThemeProvider } from '@mui/material/styles';


// TODO: Update API Urls here ->
/* -> */ const RestApiUrl = 'https://<REST API ID>.execute-api.<REGION>.amazonaws.com/<STAGE>/';
/* -> */ const WebsocketUrl = 'wss://<WS API ID>.execute-api.<REGION>.amazonaws.com/<STAGE>';


function Copyright(props) {
  return (
    <Typography variant="body2" color="text.secondary" align="center" {...props}>
      {'Copyright © '}
      {new Date().getFullYear()}, <Link color="inherit" href="https://aws.amazon.com/">Amazon Web Services, Inc.</Link> or its affiliates. All rights reserved.
    </Typography>
  );
}

// const characters = string.ascii_letters + string.digits;
// const id = ''.join(random.choice(characters) for i in range(16));
const client = new W3CWebSocket(WebsocketUrl);

export default class App extends Component {

  componentDidMount() {
    client.onopen = (event) => {
      client.send("Client connected");
    };

    client.onmessage = (event) => {
      if (event.data) {
        var result = JSON.parse(event.data);
        if (result.connectionId) {
          this.setState({connectionId: result.connectionId});
        }
        if (result.error) {
          this.setState({resultError: true})
        } else {
          this.setState({resultError: false})
        }
        if (result.message) {
          this.setState({resultMessage: result.message})
        }
      }
    };
  }

  theme = createTheme({
    palette: {
      primary: {
        light: '#63ccff',
        main: '#039be5',
        dark: '#006db3',
        contrastText: '#000',
      },
      secondary: {
        light: '#ff5c8d',
        main: '#d81b60',
        dark: '#a00037',
        contrastText: '#fff',
      },
    },
  });


  constructor(props) {
    super(props);
    var countries = countryList().getData();

    this.state = {
      files: [],
      countries: countries,
      country: 'FR',
      countryBirth: 'FR',
      birthDate: new Date(),
      dialogOpen: false
    };
  };

  onDropRejected() {
    alert('You must upload an image (under 2 MB)');
  }

  onDropAccepted = (files) => {
    let file = files[0];

    if (!file) {
      return;
    }

    // GET pre-signed URL
    axios.get(RestApiUrl+'?contentType='+file.type).then((response) => {
      // console.debug(response);

      this.setState({
        s3key: response.data.key
      });

      let config = {
        headers: {
          'Content-Type': file.type,
        }
      }
      // PUT request to the pre-signed URL
      axios.put(response.data.uploadURL, file, config).then((response) => {
        this.setState({
          name: file.name,
          size: file.size,
          preview: URL.createObjectURL(file)
        });
      }).catch(function (error) {
        console.error(error);
        alert('Cannot upload your picture right now: '+ error.message);
      });
    }).catch(function (error) {
      console.error(error);
      alert('Cannot upload your picture right now: '+ error.message)
    });
  };

  submitEnabled = () => {
    return this.state.birthDate
    && this.state.countryBirth
    && this.state.country
    && this.state.s3key
    && document.getElementById('firstname').value
    && document.getElementById('lastname').value
    && document.getElementById('postalcode').value
    && document.getElementById('city').value
    && document.getElementById('street').value
    && document.getElementById('email').value
  }

  dateChanged = (newDate) => {
    this.setState({birthDate : newDate})
  }

  countryBirthChanged = (event) => {
    this.setState({countryBirth: event.target.value})
  }

  handleDialogClose = (retry) => {
    this.setState({dialogOpen : false});

    if (retry == true) {
      this.submitForm();
    }
  }

  submitForm = () => {
    this.setState({resultMessage: ''});
    console.log(this.state.formData)
    axios.post(RestApiUrl+'user', this.state.formData).then((response) => {
      if (response.status == 202) {
        URL.revokeObjectURL(this.state.preview);
        this.setState({
          dialogTitle: 'Request acknowledged',
          dialogText: 'We received your request to create a new account. We will process it and validate the provided information. Please don\'t close this window.',
          dialogError: false,
          dialogOpen: true
        });
      } else {
        console.log(response.status);
        this.setState({
          dialogTitle: 'Error',
          dialogText: 'We could not process your request. Please, verify your input and try again. <br /> Error details: '+response.data,
          dialogError: true,
          dialogOpen: true
        });
      }
    }).catch((err) => {
      console.error(err);
    });
  }

  handleSubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    this.setState({
      formData: {
        firstname: data.get('firstname'),
        lastname: data.get('lastname'),
        birthdate: this.state.birthDate.getFullYear() + "-" + (this.state.birthDate.getMonth()<10?"0":"") + (this.state.birthDate.getMonth()+1) + "-" + (this.state.birthDate.getDate()<10?"0":"") + this.state.birthDate.getDate(),
        countrybirth: this.state.countryBirth,
        country: this.state.country,
        postalcode: data.get('postalcode'),
        city: data.get('city'),
        street: data.get('street'),
        email: data.get('email'),
        idcard: this.state.s3key,
        connectionId: this.state.connectionId
      }
    }, function() { this.submitForm() });
  };

  render() {

    const countries = [];
    this.state.countries.forEach(country => {
      countries.push(<MenuItem value={country.value}>{country.label}</MenuItem>)
    })

    return (
      <ThemeProvider theme={this.theme}>
      <Dialog
        open={this.state.dialogOpen}
        onClose={this.handleDialogClose}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description">

          <DialogTitle id="alert-dialog-title">
            {this.state.dialogTitle}
          </DialogTitle>

          <DialogContent>
            <DialogContentText id="alert-dialog-description">
            {this.state.dialogText}
            </DialogContentText>
          </DialogContent>

          <DialogActions>
            <Button onClick={this.handleDialogClose}>OK</Button>
            {this.state.dialogError ? <Button onClick={this.handleDialogClose(true)} autoFocus>
              Retry
            </Button> : "" }
          </DialogActions>

      </Dialog>
      <Container component="main" maxWidth="lg">
        <CssBaseline />
        <Box
          sx={{
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            borderWidth: 2,
            borderStyle: 'solid',
            borderRadius: 4,
            borderColor: '#ccc'
          }}>

          <Avatar sx={{ m: 1, bgcolor: 'primary.main' }}>
            <CreditCardIcon />
          </Avatar>
          <Typography component="h1" variant="h5">
            Open your account in a couple of minutes
          </Typography><br/>
          <Box component="form" onSubmit={this.handleSubmit} noValidate sx={{ width:600 }}>
            <Typography component="h3" variant="h7">
              Identity
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  margin="normal"
                  required
                  fullWidth
                  id="firstname"
                  label="First name"
                  name="firstname" />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  margin="normal"
                  required
                  fullWidth
                  id="lastname"
                  label="Last name"
                  name="lastname" />
              </Grid>
            </Grid>
            <br/>
            <Grid container spacing={2}>
              <Grid item xs={4}>
                <LocalizationProvider dateAdapter={AdapterDateFns} locale={frLocale}>
                  <DatePicker
                    id="birthdate"
                    label="Birth date"
                    renderInput={(params) => <TextField {...params} />}
                    value={this.state.birthDate}
                    maxDate={new Date()}
                    onChange={this.dateChanged} />
                </LocalizationProvider>
              </Grid>
              <Grid item xs={8}>
              <FormControl fullWidth>
                <InputLabel id="country-birth-label">Country of birth</InputLabel>
                <Select
                  labelId="country-birth-label"
                  id="country-birth"
                  value={this.state.countryBirth}
                  label="Country of birth"
                  onChange={this.countryBirthChanged}>
                  {countries}
                </Select>
              </FormControl>
              </Grid>
            </Grid>
            <br/>
              <label>ID card *</label>
              <Tooltip title="Provide a photo of the front of your ID card, in order to validate your identity">
                <IconButton><HelpIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Dropzone
                onDropAccepted={this.onDropAccepted}
                onDropRejected={this.onDropRejected}
                accept='image/*' maxSize={2 * 1024 * 1024}>
                {({ getRootProps, getInputProps }) => (
                  <section>
                    <div {...getRootProps({ className: 'dropzone' })}>
                      <input {...getInputProps()} />
                      <p>Drag 'n' drop an image here, or click to select a file</p>
                    </div>
                    {this.state.preview ?
                      <div id="thumb" className="thumb">
                        <div className="thumbInner">
                          <img
                            id="preview"
                            src={this.state.preview}
                            className="preview" />
                        </div>
                      </div> : "" }
                  </section>
                )}
              </Dropzone>
              <br/>
              <Typography component="h3" variant="h7">
                Address
              </Typography><br/>
              <FormControl fullWidth disabled>
                <InputLabel id="country-label">Country of residence</InputLabel>
                <Select
                  labelId="country-label"
                  id="country"
                  value={this.state.country}
                  label="Country of residence">
                  <MenuItem value='FR'>France</MenuItem>
                </Select>
              </FormControl>
              <br/>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <TextField
                    margin="normal"
                    required
                    fullWidth
                    id="postalcode"
                    label="Postal Code"
                    name="postalcode" />
                </Grid>
                <Grid item xs={8}>
                  <TextField
                    margin="normal"
                    required
                    fullWidth
                    id="city"
                    label="City"
                    name="city" />
                </Grid>
              </Grid>
              <TextField
                margin="normal"
                required
                fullWidth
                id="street"
                label="Street (name & number)"
                name="street" />
              <TextField
                margin="normal"
                required
                fullWidth
                id="email"
                label="Email Address"
                name="email"
                autoComplete="email" />
              <br/>
                {this.state.resultMessage ?
                  <Alert severity={this.state.resultError?"error":"success"}>{this.state.resultMessage}</Alert> : ""}
                <Grid item container justifyContent="flex-end">
                  <Button
                    type="submit"
                    variant="contained"
                    endIcon={<SendIcon />}
                    sx={{ mt: 3, mb: 3 }} >
                    Open my account
                  </Button>
              </Grid>
          </Box>
        </Box>
        <Copyright sx={{ mt: 2, mb: 2 }} />
      </Container>
      </ThemeProvider>

    );
  };
};
